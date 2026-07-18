#!/usr/bin/env python3
"""
AI Server MQTT Monitor
Collects system metrics (CPU, RAM, GPU, VRAM, Context) and publishes to MQTT
for Home Assistant integration via MQTT Discovery.
"""

import json
import logging
import os
import re
import signal
import sys
import time
from pathlib import Path
from threading import Event

import paho.mqtt.client as mqtt
import psutil
import requests
import yaml
try:
    import pynvml  # provided by nvidia-ml-py package
except ImportError:
    pynvml = None

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("monitor")

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
_running = True


def _handle_signal(signum, frame):
    global _running
    log.info("Received signal %s – shutting down …", signum)
    _running = False


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def _resolve_env(value: str) -> str:
    """Replace ${VAR} and ${VAR:-default} patterns with environment variable values."""
    if not isinstance(value, str):
        return value
    def _replacer(m):
        var = m.group(1)
        default = m.group(2)
        val = os.environ.get(var)
        if val is not None:
            return val
        if default is not None:
            return default
        return m.group(0)
    return re.sub(r"\$\{(\w+)(?::-([^}]*))?\}", _replacer, value)


def _deep_resolve(obj):
    """Recursively resolve ${VAR} in dicts / lists / scalars."""
    if isinstance(obj, dict):
        return {k: _deep_resolve(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deep_resolve(item) for item in obj]
    return _resolve_env(obj)


def load_config(path: str = "/app/config.yaml") -> dict:
    config_path = Path(path)
    if not config_path.exists():
        log.error("Config file not found: %s", path)
        sys.exit(1)
    with open(config_path, "r") as fh:
        raw = yaml.safe_load(fh)
    return _deep_resolve(raw)


# ---------------------------------------------------------------------------
# Metric collectors
# ---------------------------------------------------------------------------
def get_cpu_usage() -> dict:
    return {"percent": psutil.cpu_percent(interval=1)}


def get_ram_usage() -> dict:
    vm = psutil.virtual_memory()
    return {
        "total_gb": round(vm.total / (1024 ** 3), 2),
        "used_gb": round(vm.used / (1024 ** 3), 2),
        "total_mib": round(vm.total / (1024 ** 2), 2),
        "used_mib": round(vm.used / (1024 ** 2), 2),
        "percent": vm.percent,
    }


_nvml_handle = None
_nvml_initialized = False


def _init_nvml():
    """Lazy-initialise NVML once and return the cached handle."""
    global _nvml_handle, _nvml_initialized
    if pynvml is None:
        raise RuntimeError("nvidia-ml-py is not installed")
    if not _nvml_initialized:
        pynvml.nvmlInit()
        _nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        _nvml_initialized = True
    return _nvml_handle


def _shutdown_nvml():
    global _nvml_initialized
    if pynvml is not None and _nvml_initialized:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass
        _nvml_initialized = False


def get_gpu_usage() -> dict:
    try:
        handle = _init_nvml()
        utils = pynvml.nvmlDeviceGetUtilizationRates(handle)
        temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        return {"percent": utils.gpu, "temp_c": temp}
    except Exception as exc:
        log.warning("Failed to read GPU metrics: %s", exc)
        return {"percent": -1, "temp_c": -1}


def get_vram_usage() -> dict:
    try:
        handle = _init_nvml()
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        total_gb = round(info.total / (1024 ** 3), 2)
        used_gb = round(info.used / (1024 ** 3), 2)
        total_mib = round(info.total / (1024 ** 2), 2)
        used_mib = round(info.used / (1024 ** 2), 2)
        percent = round(used_gb / total_gb * 100, 2) if total_gb else 0
        return {"total_gb": total_gb, "used_gb": used_gb, "total_mib": total_mib, "used_mib": used_mib, "percent": percent}
    except Exception as exc:
        log.warning("Failed to read VRAM metrics: %s", exc)
        return {"total_gb": -1, "used_gb": -1, "total_mib": -1, "used_mib": -1, "percent": -1}


def _parse_prometheus_metric(text: str, name: str):
    """Return the value of a Prometheus metric line, or None if not found."""
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(name + " ") or line.startswith(name + "{"):
            try:
                return float(line.rsplit(" ", 1)[1])
            except (ValueError, IndexError):
                return None
    return None


def get_llama_metrics(config: dict) -> dict:
    """
    Fetch all llama.cpp server metrics in one pass.

    Sources:
      /props   — total_slots, is_sleeping                       (always available)
      /slots   — is_processing for state, n_ctx                 (always available)
      /metrics — KV cache usage + TPS + queue (Prometheus)      (requires --metrics)

    Context usage comes from /metrics when available (accurate KV ratio).
    Falls back to n_past/n_kv from /slots if present (not all forks expose these).
    """
    api_url = config.get("llama", {}).get("api_url", "http://llama:8080")

    out = {
        "state": "unknown", "active_slots": -1, "total_slots": -1,
        "total_tokens": -1, "used_tokens": -1, "percent": -1,
        "prompt_tps": 0, "gen_tps": 0,
        "requests_processing": 0, "requests_deferred": 0,
    }

    try:
        # ── /props ──────────────────────────────────────────────
        try:
            props = requests.get(f"{api_url}/props", timeout=5).json()
            out["total_slots"] = props.get("total_slots", 1)
            if props.get("is_sleeping", False):
                out.update({"state": "sleeping", "active_slots": 0,
                            "total_tokens": 0, "used_tokens": 0, "percent": 0})
                return out
        except Exception as exc:
            log.debug("Could not read /props: %s", exc)

        # ── /slots  (state + optional context fallback) ─────────
        slots_resp = requests.get(f"{api_url}/slots", timeout=5)
        slots_resp.raise_for_status()
        slots = slots_resp.json()

        ctx_size = 0
        if isinstance(slots, list) and slots:
            active = sum(1 for s in slots if s.get("is_processing", False))
            out["active_slots"] = active
            out["state"] = "processing" if active > 0 else "idle"
            ctx_size = max((s.get("n_ctx", 0) for s in slots), default=0)

            # n_past / n_kv: present in mainline llama.cpp, absent in some forks (e.g. beellama)
            used = sum(s.get("n_past") or s.get("n_kv") or 0 for s in slots)
            if ctx_size > 0 and used > 0:
                out["total_tokens"] = ctx_size
                out["used_tokens"] = used
                out["percent"] = round(used / ctx_size * 100, 2)
            elif ctx_size > 0:
                # Fallback: use n_prompt_tokens from active slots (beellama-style forks)
                prompt_used = sum(
                    s.get("n_prompt_tokens", 0)
                    for s in slots if s.get("is_processing", False)
                )
                out["total_tokens"] = ctx_size
                if prompt_used > 0:
                    out["used_tokens"] = prompt_used
                    out["percent"] = round(prompt_used / ctx_size * 100, 2)
                else:
                    out["used_tokens"] = 0
                    out["percent"] = 0
        else:
            out["state"] = "idle"
            out["active_slots"] = 0

        # ── /metrics  (KV cache + TPS — requires --metrics) ─────
        try:
            resp = requests.get(f"{api_url}/metrics", timeout=3)
            if resp.ok:
                text = resp.text

                # Context from KV cache ratio (accurate — mainline llama.cpp)
                # beellama fork does not expose these metrics; slots fallback is used instead
                ratio = _parse_prometheus_metric(text, "llamacpp:kv_cache_usage_ratio")
                kv_tokens = _parse_prometheus_metric(text, "llamacpp:kv_cache_tokens")
                if ratio is not None:
                    out["percent"] = round(ratio * 100, 2)
                    if kv_tokens is not None:
                        out["used_tokens"] = int(kv_tokens)
                    if ctx_size > 0 and ratio > 0 and out["used_tokens"] > 0:
                        out["total_tokens"] = round(out["used_tokens"] / ratio)
                    elif ctx_size > 0:
                        out["total_tokens"] = ctx_size

                for key, metric_name in [
                    ("prompt_tps",          "llamacpp:prompt_tokens_seconds"),
                    ("gen_tps",             "llamacpp:predicted_tokens_seconds"),
                    ("requests_processing", "llamacpp:requests_processing"),
                    ("requests_deferred",   "llamacpp:requests_deferred"),
                ]:
                    val = _parse_prometheus_metric(text, metric_name)
                    if val is not None:
                        out[key] = round(val, 2) if key.endswith("_tps") else int(val)
            else:
                log.debug("/metrics returned HTTP %s — start llama with --metrics for TPS data", resp.status_code)
        except Exception as exc:
            log.debug("Could not read /metrics (--metrics not enabled?): %s", exc)

        return out

    except Exception as exc:
        log.warning("Failed to read llama.cpp metrics from %s: %s", api_url, exc)
        return out


# ---------------------------------------------------------------------------
# MQTT
# ---------------------------------------------------------------------------
class MQTTPublisher:
    def __init__(self, config: dict):
        mqtt_cfg = config["mqtt"]
        self.host = mqtt_cfg["host"]
        self.port = mqtt_cfg["port"]
        self.base_topic = mqtt_cfg.get("base_topic", "ai-server")
        self.discovery_prefix = mqtt_cfg.get("discovery_prefix", "homeassistant")
        self.qos = mqtt_cfg.get("qos", 1)
        self.retain = mqtt_cfg.get("retain", True)

        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="ai-server-monitor",
        )

        username = mqtt_cfg.get("username")
        password = mqtt_cfg.get("password")
        if username:
            self._client.username_pw_set(username, password or "")

        self._connected = Event()

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    def connect(self):
        log.info("Connecting to MQTT broker at %s:%s …", self.host, self.port)
        # Last Will: broker publishes 'offline' if the monitor drops unexpectedly
        self._client.will_set(
            f"{self.base_topic}/status", "offline", qos=self.qos, retain=True
        )
        self._client.connect(self.host, self.port, keepalive=60)
        self._client.loop_start()
        # Wait up to 30 s for the broker to accept the connection
        if not self._connected.wait(timeout=30):
            log.error("MQTT connection timed out")
            sys.exit(1)

    def disconnect(self):
        self._client.loop_stop()
        self._client.disconnect()

    def _on_connect(self, client, userdata, flags, rc, properties):
        if rc == 0:
            log.info("MQTT connected successfully.")
            self._connected.set()
        else:
            log.error("MQTT connect failed with code %s", rc)

    def _on_disconnect(self, client, userdata, disconnect_flags, rc, properties):
        if _running and rc != 0:
            log.warning("MQTT disconnected (code %s) – will reconnect …", rc)

    def publish(self, topic: str, payload: dict):
        msg = json.dumps(payload)
        self._client.publish(topic, msg, qos=self.qos, retain=self.retain)

    def publish_discovery(self, sensor_name: str, device_name: str, value_topic: str,
                          unit: str = "", icon: str = "", device_class: str = "",
                          value_template: str = "{{ value_json.percent }}",
                          state_class: str = "measurement"):
        disc_topic = (
            f"{self.discovery_prefix}/sensor/{self.base_topic}/{sensor_name}/config"
        )
        config_payload = {
            "name": sensor_name.replace("_", " ").title(),
            "unique_id": f"{self.base_topic}_{sensor_name}",
            "device": {
                "identifiers": [self.base_topic],
                "name": device_name,
                "model": "AI Server",
                "sw_version": "1.0",
            },
            "state_topic": value_topic,
            "value_template": value_template,
            "availability_topic": f"{self.base_topic}/status",
            "payload_available": "online",
            "payload_not_available": "offline",
        }
        if state_class:
            config_payload["state_class"] = state_class
        if unit:
            config_payload["unit_of_measurement"] = unit
        if icon:
            config_payload["icon"] = icon
        if device_class:
            config_payload["device_class"] = device_class
        payload_json = json.dumps(config_payload)
        self._client.publish(disc_topic, payload_json,
                             qos=self.qos, retain=True)
        log.info("Published discovery for '%s' → %s", sensor_name, disc_topic)
        log.debug("  Discovery payload: %s", payload_json)


def publish_discovery_config(publisher: MQTTPublisher):
    """Send all Home Assistant MQTT Discovery configurations once at startup."""
    base = publisher.base_topic

    sensors = [
        {
            "name": "cpu_usage",
            "value_topic": f"{base}/cpu/usage",
            "unit": "%",
            "icon": "mdi:speedometer",
            "value_template": "{{ value_json.percent }}",
        },
        {
            "name": "ram_usage",
            "value_topic": f"{base}/ram/usage",
            "unit": "%",
            "icon": "mdi:memory",
            "value_template": "{{ value_json.percent }}",
        },
        {
            "name": "ram_usage_mb",
            "value_topic": f"{base}/ram/usage",
            "unit": "MiB",
            "icon": "mdi:memory",
            "device_class": "data_size",
            "value_template": "{{ value_json.used_mib }}",
        },
        {
            "name": "gpu_usage",
            "value_topic": f"{base}/gpu/usage",
            "unit": "%",
            "icon": "mdi:speedometer",
            "value_template": "{{ value_json.percent }}",
        },
        {
            "name": "gpu_temperature",
            "value_topic": f"{base}/gpu/usage",
            "unit": "°C",
            "icon": "mdi:thermometer",
            "device_class": "temperature",
            "value_template": "{{ value_json.temp_c }}",
        },
        {
            "name": "vram_usage",
            "value_topic": f"{base}/vram/usage",
            "unit": "%",
            "icon": "mdi:memory",
            "value_template": "{{ value_json.percent }}",
        },
        {
            "name": "vram_usage_mb",
            "value_topic": f"{base}/vram/usage",
            "unit": "MiB",
            "icon": "mdi:memory",
            "device_class": "data_size",
            "value_template": "{{ value_json.used_mib }}",
        },
        {
            "name": "context_usage",
            "value_topic": f"{base}/context/usage",
            "unit": "%",
            "icon": "mdi:texture-box",
            "value_template": "{{ value_json.percent }}",
        },
        {
            "name": "context_tokens_used",
            "value_topic": f"{base}/context/usage",
            "unit": "tokens",
            "icon": "mdi:counter",
            "value_template": "{{ value_json.used_tokens }}",
        },
        {
            "name": "llama_state",
            "value_topic": f"{base}/llama/status",
            "unit": "",
            "icon": "mdi:robot",
            "value_template": "{{ value_json.state }}",
            "state_class": "",  # text sensor — not a numeric measurement
        },
        {
            "name": "llama_active_slots",
            "value_topic": f"{base}/llama/status",
            "unit": "",
            "icon": "mdi:application-cog",
            "value_template": "{{ value_json.active_slots }}",
        },
        {
            "name": "llama_prompt_tps",
            "value_topic": f"{base}/context/usage",
            "unit": "tokens/s",
            "icon": "mdi:fast-forward",
            "value_template": "{{ value_json.prompt_tps }}",
        },
        {
            "name": "llama_gen_tps",
            "value_topic": f"{base}/context/usage",
            "unit": "tokens/s",
            "icon": "mdi:play-speed",
            "value_template": "{{ value_json.gen_tps }}",
        },
        {
            "name": "llama_requests_deferred",
            "value_topic": f"{base}/context/usage",
            "unit": "",
            "icon": "mdi:timer-sand",
            "value_template": "{{ value_json.requests_deferred }}",
        },
    ]

    for s in sensors:
        publisher.publish_discovery(
            sensor_name=s["name"],
            device_name="AI Server",
            value_topic=s["value_topic"],
            unit=s["unit"],
            icon=s["icon"],
            device_class=s.get("device_class", ""),
            value_template=s.get("value_template", "{{ value_json.percent }}"),
            state_class=s.get("state_class", "measurement"),
        )


# ---------------------------------------------------------------------------
# Main polling loop
# ---------------------------------------------------------------------------
def main():
    config = load_config()
    interval = config.get("monitoring", {}).get("polling_interval", 15)

    publisher = MQTTPublisher(config)
    publisher.connect()

    # Mark online immediately so HA doesn't see newly discovered sensors as unavailable
    publisher._client.publish(
        f"{publisher.base_topic}/status", "online", qos=publisher.qos, retain=True
    )

    # Send discovery config
    publish_discovery_config(publisher)

    base = publisher.base_topic

    log.info("Starting polling loop (interval=%ss) …", interval)

    while _running:
        try:
            # CPU
            cpu = get_cpu_usage()
            publisher.publish(f"{base}/cpu/usage", cpu)
            log.debug("CPU: %.1f%%", cpu["percent"])

            # RAM
            ram = get_ram_usage()
            publisher.publish(f"{base}/ram/usage", ram)
            log.debug("RAM: %.1f%% (%.1f/%.1f GB)", ram["percent"], ram["used_gb"], ram["total_gb"])

            # GPU
            gpu = get_gpu_usage()
            publisher.publish(f"{base}/gpu/usage", gpu)
            log.debug("GPU: %.1f%% @ %d°C", gpu["percent"], gpu["temp_c"])

            # VRAM
            vram = get_vram_usage()
            publisher.publish(f"{base}/vram/usage", vram)
            log.debug("VRAM: %.1f%% (%.1f/%.1f GB)", vram["percent"], vram["used_gb"], vram["total_gb"])

            # Context + state + speed (single pass against llama.cpp)
            llama = get_llama_metrics(config)
            publisher.publish(f"{base}/context/usage", {
                "total_tokens":       llama["total_tokens"],
                "used_tokens":        llama["used_tokens"],
                "percent":            llama["percent"],
                "prompt_tps":         llama["prompt_tps"],
                "gen_tps":            llama["gen_tps"],
                "requests_processing":llama["requests_processing"],
                "requests_deferred":  llama["requests_deferred"],
            })
            publisher.publish(f"{base}/llama/status", {
                "state":        llama["state"],
                "active_slots": llama["active_slots"],
                "total_slots":  llama["total_slots"],
            })
            log.debug(
                "Llama: %s | ctx %.1f%% (%d/%d tok) | prompt=%.1f gen=%.1f t/s | queued=%d",
                llama["state"], llama["percent"],
                llama["used_tokens"], llama["total_tokens"],
                llama["prompt_tps"], llama["gen_tps"],
                llama["requests_deferred"],
            )

            # Availability heartbeat
            publisher._client.publish(f"{base}/status", "online", qos=publisher.qos, retain=True)

            log.info("Metrics published successfully.")

        except Exception as exc:
            log.error("Error during polling: %s", exc, exc_info=True)

        # Sleep in small increments so the shutdown signal is responsive
        for _ in range(int(interval * 10)):
            if not _running:
                break
            time.sleep(0.1)

    # Final offline message
    try:
        publisher._client.publish(f"{base}/status", "offline", qos=publisher.qos, retain=True)
    except Exception:
        pass
    publisher.disconnect()
    _shutdown_nvml()
    log.info("Monitor stopped.")


if __name__ == "__main__":
    main()
