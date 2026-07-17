# AI Server MQTT Monitor

Standalone Docker-based monitor that collects system metrics (CPU, RAM, GPU, VRAM, Context) and publishes them via **MQTT** for Home Assistant integration using MQTT Discovery.

## Quick Start

### 1. Prerequisites

- **Docker** with **NVIDIA Container Toolkit** installed
- **NVIDIA GPU** with up-to-date drivers
- **MQTT broker** running and accessible (e.g., Mosquitto on your Home Assistant)
- This repository cloned to your server

### 2. Configure MQTT

Edit [`config.yaml`](config.yaml) with your MQTT broker details:

```yaml
mqtt:
  host: 192.168.0.10      # Your MQTT broker IP
  port: 1883
  username: ${MQTT_USER}  # Resolved from environment variable
  password: ${MQTT_PASS}
  discovery_prefix: homeassistant
  base_topic: ai-server
  qos: 1
  retain: true

monitoring:
  polling_interval: 15    # Seconds between metric collections

llama:
  api_url: http://llama:8080
```

### 3. Set Environment Variables

Create a `.env` file in the project root:

```env
MQTT_USER=your_mqtt_username
MQTT_PASS=your_mqtt_password
```

### 4. Start the Monitor

```bash
docker compose up -d --build
```

To stop or view logs:

```bash
docker compose down
docker compose logs -f
```

> **Note:** The monitor connects to llama.cpp via Docker's internal DNS (`http://llama:8080`). Make sure it runs on the same Docker host/network as your AI services, or update `llama.api_url` in [`config.yaml`](config.yaml) to use the host IP.

## MQTT Topics

All topics use the configurable `base_topic` (default: `ai-server`).

### Telemetry Topics

| Topic | Payload Example | Description |
|-------|-----------------|-------------|
| `ai-server/cpu/usage` | `{"percent": 45.2}` | CPU usage percentage |
| `ai-server/ram/usage` | `{"total_gb": 32, "used_gb": 18.5, "percent": 57.8}` | RAM usage |
| `ai-server/gpu/usage` | `{"percent": 72.0, "temp_c": 65}` | GPU utilization and temperature |
| `ai-server/vram/usage` | `{"total_gb": 24, "used_gb": 16.2, "percent": 67.5}` | VRAM usage |
| `ai-server/context/usage` | `{"total_tokens": 100000, "used_tokens": 45230, "percent": 45.23}` | Context window usage |
| `ai-server/status` | `"online"` / `"offline"` | Availability heartbeat |

### MQTT Discovery Topics

The monitor auto-publishes Home Assistant discovery configs on startup:

| Sensor | Discovery Topic |
|--------|-----------------|
| CPU Usage | `homeassistant/sensor/ai-server/cpu_usage/config` |
| RAM Usage | `homeassistant/sensor/ai-server/ram_usage/config` |
| GPU Usage | `homeassistant/sensor/ai-server/gpu_usage/config` |
| VRAM Usage | `homeassistant/sensor/ai-server/vram_usage/config` |
| Context Usage | `homeassistant/sensor/ai-server/context_usage/config` |

Home Assistant will automatically create sensors under the device **"AI Server"**.

## Project Structure

```
.
├── docker-compose.yml      # Monitor service definition
├── config.yaml             # MQTT and monitoring configuration
├── .env                    # Environment variables (MQTT_USER, MQTT_PASS)
├── Dockerfile              # Monitor container build
├── requirements.txt        # Python dependencies
├── monitor.py              # Main monitoring script
└── README.md               # This file
```

## Configuration Reference

### [`config.yaml`](config.yaml)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mqtt.host` | string | `192.168.0.10` | MQTT broker address |
| `mqtt.port` | int | `1883` | MQTT broker port |
| `mqtt.username` | string | `${MQTT_USER}` | MQTT username (supports env vars) |
| `mqtt.password` | string | `${MQTT_PASS}` | MQTT password (supports env vars) |
| `mqtt.discovery_prefix` | string | `homeassistant` | HA discovery topic prefix |
| `mqtt.base_topic` | string | `ai-server` | Base topic for all telemetry |
| `mqtt.qos` | int | `1` | MQTT Quality of Service |
| `mqtt.retain` | bool | `true` | Retain published messages |
| `monitoring.polling_interval` | int | `15` | Seconds between metric polls |
| `llama.api_url` | string | `http://llama:8080` | llama.cpp server URL |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MQTT_USER` | Optional | MQTT username (used when `${MQTT_USER}` in config) |
| `MQTT_PASS` | Optional | MQTT password (used when `${MQTT_PASS}` in config) |
| `NVIDIA_VISIBLE_DEVICES` | Yes (for monitor) | Set to `all` for GPU access |
| `NVIDIA_DRIVER_CAPABILITIES` | Yes (for monitor) | Set to `compute,utility` |

## Troubleshooting

### Monitor fails to read GPU metrics

Ensure the NVIDIA Container Toolkit is installed and the `runtime: nvidia` directive is set in [`docker-compose.yml`](docker-compose.yml). Verify with:

```bash
docker compose exec monitor-mqtt python -c "import pynvml; pynvml.nvmlInit(); print('NVML OK')"
```

### MQTT connection refused

- Verify the broker IP in [`config.yaml`](config.yaml) is reachable from the Docker network
- Check firewall rules allow traffic on port `1883`
- Confirm credentials with: `mosquitto_sub -h <host> -u <user> -P <pass> -t "test"`

### Context metrics show `-1`

The `/health` endpoint of llama.cpp may vary between versions. Check the raw response:

```bash
docker compose exec monitor-mqtt python -c "import requests; print(requests.get('http://llama:8080/health').json())"
```

If the schema changed, update the `get_context_usage()` function in [`monitor.py`](monitor.py).

### Home Assistant sensors not appearing

1. Verify MQTT discovery messages were published:
   ```bash
   mosquitto_sub -h <host> -u <user> -P <pass> -t "homeassistant/+/+/+/config" -C 1
   ```
2. Check HA logs for MQTT integration errors
3. Ensure the MQTT integration is configured in Home Assistant

## License

MIT
