# Adaptive Maritime Routing — A* Pathfinding Through Dynamic Ocean Currents

An interactive simulation of A* pathfinding for ship navigation through dynamic ocean current vector fields, with moving obstacles, real-time route visualization, and a live C++ backend for path computation.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white) ![C++](https://img.shields.io/badge/C++-17-00599C?logo=cplusplus&logoColor=white) ![CMake](https://img.shields.io/badge/CMake-3.16+-064F8C?logo=cmake&logoColor=white) ![License](https://img.shields.io/badge/License-MIT-green)

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [How It Works](#how-it-works)
4. [Features](#features)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [Installation](#installation)
8. [Running the System](#running-the-system)
9. [API Reference](#api-reference)
10. [Motivation](#motivation)
11. [Future Work](#future-work)

## Overview

Most A* demonstrations route around static obstacles on a fixed grid. This project extends that model with a continuously shifting environment: a **vector field representing ocean currents** displaces a moving agent (a ship) from its planned path, while **dynamic obstacles** move during simulation. The system must continuously re-evaluate its route rather than computing a single static path once.

The routing logic exists in two forms: a TypeScript engine running entirely client-side for the interactive browser demo, and a standalone C++ backend (built on the Crow web framework) that the frontend can call live over HTTP and WebSocket for path computation.

## System Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                  React + Vite Frontend                  │
│   ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│   │  Simulation │  │   Canvas     │  │   Analytics   │  │
│   │   Engine    │  │  Rendering   │  │     Panel     │  │
│   │ (TypeScript)│  │              │  │               │  │
│   └──────┬──────┘  └──────────────┘  └───────────────┘  │
│          │                                               │
│   ┌──────▼──────────────────────────────────────────┐    │
│   │              backendApi.ts (client)              │    │
│   └──────┬───────────────┬───────────────┬───────────┘    │
└──────────┼───────────────┼───────────────┼───────────────┘
           │ POST          │ POST          │ WS
           │ /compute-path │ /simulate-step │ /ws
           ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│              C++ Backend (Crow, port 8080)               │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────┐     │
│  │   A*       │  │ Vector Field │  │ Step Simulator │     │
│  │ (astar.cpp)│  │(vector_field)│  │(step_simulator)│     │
│  └────────────┘  └─────────────┘  └────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

The frontend can run the simulation entirely in-browser using the TypeScript engine, or delegate path computation to the C++ backend — the `algorithm` parameter on `/compute-path` selects between `vector_field`, `astar`, or `both` for direct comparison.

## How It Works

1. **Scene setup** — the user defines a start point, goal, obstacles, and current strength via the UI controls.
2. **Vector field generation** — `oceanCurrents.ts` (frontend) and `vector_field.cpp` (backend) build a vector field representing current direction and strength across the simulation space.
3. **Pathfinding** — `astar.ts` / `astar.cpp` compute a route from start to goal, factoring in movement cost.
4. **Step simulation** — the ship is advanced step by step, where its actual displacement is influenced by both its intended heading and the current vector at its position — meaning it can drift off the originally computed path.
5. **Dynamic re-routing** — as obstacles move and the ship drifts, `navigationEscape.ts` and `vectorFieldNavigation.ts` re-evaluate the route to stay on course toward the goal.
6. **Backend delegation (optional)** — instead of running the simulation purely client-side, the frontend can call the C++ backend via `fetchPath()` (one-shot), `fetchStep()` (HTTP, step-by-step), or `StepWebSocket` (real-time, low-latency step streaming).
7. **Rendering** — the canvas layer renders the ship, obstacles, route, and current field in real time, with toggleable overlays.
8. **Analytics** — the analytics panel tracks metrics on the run, such as path efficiency and deviation from the optimal static path.

## Features

- A* pathfinding with cost-aware routing, implemented independently in both TypeScript and C++
- Real-time ocean current vector fields that physically displace the agent
- Dynamic, moving obstacles requiring continuous re-routing
- Live C++ backend (Crow framework) exposing path computation over HTTP and WebSocket
- Three computation modes: full-path, step-by-step (HTTP), and step-by-step (WebSocket, low latency)
- Algorithm comparison mode (`vector_field` vs `astar` vs `both`) via a single API parameter
- Spatial partitioning for efficient proximity queries
- Canvas-based real-time rendering with toggleable current/vector field overlays
- Live analytics panel for inspecting simulation performance
- Scene persistence — save and reload simulation setups
- Auto-reconnecting WebSocket client with graceful error handling and timeouts

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, HTML Canvas
**Backend:** C++17, [Crow](https://github.com/CrowCpp/Crow) (header-only HTTP/WebSocket framework), nlohmann/json, CMake (FetchContent for dependency management)

## Project Structure

```text
adaptive-maritime-routing/
├── src/
│   ├── engine/                       # Core simulation logic (TypeScript)
│   │   ├── astar.ts
│   │   ├── oceanCurrents.ts
│   │   ├── vectorFieldNavigation.ts
│   │   ├── obstacleMotion.ts
│   │   ├── navigationEscape.ts
│   │   ├── stepVectorFieldSimulation.ts
│   │   ├── spatialGrid.ts
│   │   ├── comparison.ts
│   │   └── analytics.ts
│   ├── canvas/                       # Rendering layer
│   ├── components/                   # UI components
│   ├── api/
│   │   └── backendApi.ts             # Typed client for the C++ backend
│   ├── models/                       # Ship, obstacle, vector, simulation types
│   ├── simulation/                   # Runtime orchestration + persistence
│   └── context/, hooks/, utils/
├── server/                            # C++ backend
│   ├── src/
│   │   ├── main.cpp                  # Server entrypoint (port 8080)
│   │   ├── routes.cpp / routes.h     # HTTP/WebSocket route definitions
│   │   ├── astar.cpp / astar.h
│   │   ├── vector_field.cpp / vector_field.h
│   │   ├── step_simulator.cpp / step_simulator.h
│   │   └── simulation_state.h, types.h
│   └── CMakeLists.txt                # Fetches Crow + nlohmann/json automatically
└── public/
```

## Installation

**Prerequisites:** Node.js 18+, npm, CMake 3.16+, and a C++17 compiler.

```bash
git clone https://github.com/ishwariwakchaure5/adaptive-maritime-routing.git
cd adaptive-maritime-routing
npm install
```

## Running the System

**Frontend (browser-only simulation):**
```bash
npm run dev
```

**C++ Backend (for live path computation):**
```bash
cd server
cmake -B build
cmake --build build
./build/daa_path_server
```
The server starts on `http://localhost:8080`. CMake automatically fetches Crow and nlohmann/json on first build — no manual dependency installation needed.

## API Reference

**`POST /compute-path`** — compute a full path in one shot
```json
{
  "ship": { "x": 0.1, "y": 0.5 },
  "goal": { "x": 0.9, "y": 0.5 },
  "obstacles": [{ "x": 0.5, "y": 0.5, "radius": 0.05 }],
  "algorithm": "vector_field"
}
```

**`POST /simulate-step`** — advance the simulation by a single step

**`WS /ws`** — real-time, low-latency step streaming

**`GET /health`** — health check, returns 200 if the server is up

All coordinates are normalized to `[0,1]²` space, matching the canvas. The server is stateless — `navState` is round-tripped by the client with every request.

## Motivation

Built as a Design and Analysis of Algorithms course project, extending a classical A* implementation to operate under continuously changing environmental forces, with a real backend service rather than a purely client-side toy — closer to real-world routing problems like maritime navigation or drone flight planning than a static grid search.

## Future Work

- Side-by-side visual comparison of `vector_field` vs `astar` algorithm output in the UI
- Benchmarking pathfinding efficiency under varying current strength and obstacle density
- Expanded edge-case handling for high-current or densely obstructed scenes
