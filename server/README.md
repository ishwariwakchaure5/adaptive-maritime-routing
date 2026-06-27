# DAA Path Server

C++ HTTP server using [Crow](https://crowcpp.org/) that exposes an A\* pathfinding endpoint consumed by the frontend simulation.

## Requirements

| Tool | Minimum version |
|---|---|
| CMake | 3.16 |
| C++ compiler | C++17 (GCC 9+, Clang 10+, MSVC 2019+) |
| Git | any (for FetchContent) |
| Internet access | required on first build (downloads Crow + nlohmann/json) |

## Build

```bash
# From the server/ directory:
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j4
```

The binary is placed at `build/daa_path_server` (Linux/macOS) or `build/Release/daa_path_server.exe` (Windows).

## Run

```bash
./build/daa_path_server
# Server listens on http://localhost:8080
```

## Endpoints

### `GET /health`

Returns server status.

```json
{ "status": "ok", "service": "daa-path-server" }
```

### `POST /compute-path`

Runs A\* pathfinding and returns a smoothed waypoint path.

**Request body:**
```json
{
  "ship":      { "x": 0.12, "y": 0.52 },
  "goal":      { "x": 0.88, "y": 0.42 },
  "obstacles": [
    { "x": 0.48, "y": 0.52, "radius": 0.045 },
    { "x": 0.62, "y": 0.36, "radius": 0.038 }
  ]
}
```

All coordinates are in **normalized [0, 1]² space** matching the frontend canvas.

**Response:**
```json
{
  "path": [
    { "x": 0.12,  "y": 0.52  },
    { "x": 0.306, "y": 0.394 },
    { "x": 0.88,  "y": 0.42  }
  ]
}
```

**Error responses:**

| Status | Cause |
|---|---|
| 400 | Invalid JSON, missing fields, or coordinates out of [0,1] |

## Project structure

```
server/
├── CMakeLists.txt      # Build config — fetches Crow + nlohmann/json
└── src/
    ├── main.cpp        # Entry point — creates Crow app, registers routes
    ├── routes.h/.cpp   # HTTP route handlers, JSON parsing/serialisation
    ├── astar.h/.cpp    # A* algorithm on 80×80 grid with path smoothing
    └── types.h         # Shared data types (Vec2, Obstacle, PathRequest, PathResponse)
```

## Quick test with curl

```bash
curl -s -X POST http://localhost:8080/compute-path \
  -H "Content-Type: application/json" \
  -d '{
    "ship":      {"x": 0.12, "y": 0.52},
    "goal":      {"x": 0.88, "y": 0.42},
    "obstacles": [{"x": 0.48, "y": 0.52, "radius": 0.045}]
  }' | python -m json.tool
```
