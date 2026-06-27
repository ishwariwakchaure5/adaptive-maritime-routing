#pragma once
#include <vector>

namespace daa {

struct Vec2 {
    double x{0.0};
    double y{0.0};
};

struct Obstacle {
    double x{0.0};
    double y{0.0};
    double radius{0.0};
};

struct PathRequest {
    Vec2 ship;
    Vec2 goal;
    std::vector<Obstacle> obstacles;
};

struct PathResponse {
    std::vector<Vec2> path;
};

} // namespace daa
