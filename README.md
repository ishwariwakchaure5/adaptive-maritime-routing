# Adaptive Maritime Routing — A* Pathfinding Through Dynamic Ocean Currents

An interactive simulation of A* pathfinding for ship navigation through dynamic ocean current vector fields, with moving obstacles and real-time route visualization.

## Overview

Most A* demonstrations route around static obstacles on a fixed grid. This project extends that model with a continuously shifting environment: a **vector field representing ocean currents** displaces a moving agent (a ship) from its planned path, while **dynamic obstacles** move during simulation. The system must adapt its routing in real time rather than computing a single static path.

The core pathfinding logic is implemented twice — once in TypeScript for the interactive browser simulation, and once in C++ as a standalone, CMake-built implementation of the same algorithm.

## Features

- A* pathfinding with cost-aware routing
- Ocean current vector fields that influence agent movement
- Dynamic, moving obstacles requiring real-time re-routing
- Spatial partitioning for efficient collision and lookup performance
- Route comparison logic for evaluating different navigation strategies
- Canvas-based real-time rendering, with overlays for current and vector field visualization
- An analytics panel for inspecting simulation behavior
- Scene persistence for saving and reloading simulation setups
- A parallel C++ implementation of the routing engine

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, HTML Canvas
**Simulation Engine:** Custom C++ implementation (CMake), in addition to the TypeScript engine

## Running Locally

**Frontend:**
```bash
npm install
npm run dev
```

**C++ Engine:**
```bash
cd server
cmake -B build
cmake --build build
```

## Motivation

Built as a Design and Analysis of Algorithms course project, extending a classical A* implementation to operate under continuously changing environmental forces — closer to real-world routing problems like maritime navigation or drone flight planning than a static grid search.

## Future Work

- Direct integration between the TypeScript and C++ engines for live performance comparison
- Benchmarking pathfinding efficiency under varying current strength and obstacle density
- Expanded edge-case handling for high-current or densely obstructed scenes
