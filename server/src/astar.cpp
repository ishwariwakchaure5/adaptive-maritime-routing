#include "astar.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <queue>
#include <vector>

namespace daa {

// ─── Grid constants ───────────────────────────────────────────────────────────

static constexpr int   GRID_N         = 80;
static constexpr int   TOTAL_CELLS    = GRID_N * GRID_N;
static constexpr double SHIP_CLEARANCE = 0.022;   // extra margin around obstacles
static constexpr double CARDINAL_COST = 1.0;
static constexpr double DIAGONAL_COST = 1.41421356237; // √2

// ─── Helpers ─────────────────────────────────────────────────────────────────

static inline int cellIdx(int cx, int cy) {
    return cy * GRID_N + cx;
}

static inline int normToCell(double n) {
    int c = static_cast<int>(n * GRID_N);
    return std::max(0, std::min(GRID_N - 1, c));
}

static inline double cellToNorm(int c) {
    return (c + 0.5) / static_cast<double>(GRID_N);
}

// ─── Blocked-cell map ─────────────────────────────────────────────────────────

static std::vector<bool> buildBlockedMap(const std::vector<Obstacle>& obstacles) {
    std::vector<bool> blocked(TOTAL_CELLS, false);

    for (const auto& obs : obstacles) {
        double clearance  = obs.radius + SHIP_CLEARANCE;
        double clearance2 = clearance * clearance;

        int cxMin = std::max(0, normToCell(obs.x - clearance) - 1);
        int cxMax = std::min(GRID_N - 1, normToCell(obs.x + clearance) + 1);
        int cyMin = std::max(0, normToCell(obs.y - clearance) - 1);
        int cyMax = std::min(GRID_N - 1, normToCell(obs.y + clearance) + 1);

        for (int cy = cyMin; cy <= cyMax; ++cy) {
            for (int cx = cxMin; cx <= cxMax; ++cx) {
                double nx = cellToNorm(cx);
                double ny = cellToNorm(cy);
                double dx = nx - obs.x;
                double dy = ny - obs.y;
                if (dx * dx + dy * dy <= clearance2) {
                    blocked[cellIdx(cx, cy)] = true;
                }
            }
        }
    }
    return blocked;
}

// ─── Octile heuristic ─────────────────────────────────────────────────────────

static inline double heuristic(int idx, int gx, int gy) {
    int cx = idx % GRID_N;
    int cy = idx / GRID_N;
    int dx = std::abs(cx - gx);
    int dy = std::abs(cy - gy);
    return CARDINAL_COST * (dx + dy)
         + (DIAGONAL_COST - 2.0 * CARDINAL_COST) * std::min(dx, dy);
}

// ─── 8-connected neighbours ───────────────────────────────────────────────────

struct Move { int dx, dy; double cost; };
static constexpr std::array<Move, 8> MOVES = {{
    {-1,  0, CARDINAL_COST}, { 1,  0, CARDINAL_COST},
    { 0, -1, CARDINAL_COST}, { 0,  1, CARDINAL_COST},
    {-1, -1, DIAGONAL_COST}, { 1, -1, DIAGONAL_COST},
    {-1,  1, DIAGONAL_COST}, { 1,  1, DIAGONAL_COST},
}};

// ─── Line-of-sight (Bresenham) ────────────────────────────────────────────────

static bool hasLOS(const Vec2& a, const Vec2& b, const std::vector<bool>& blocked) {
    int x0 = normToCell(a.x), y0 = normToCell(a.y);
    int x1 = normToCell(b.x), y1 = normToCell(b.y);

    int dx = std::abs(x1 - x0), dy = std::abs(y1 - y0);
    int sx = (x0 < x1) ? 1 : -1;
    int sy = (y0 < y1) ? 1 : -1;
    int err = dx - dy;

    while (true) {
        if (x0 < 0 || x0 >= GRID_N || y0 < 0 || y0 >= GRID_N) return false;
        if (blocked[cellIdx(x0, y0)]) return false;
        if (x0 == x1 && y0 == y1) return true;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}

// ─── Path smoothing ───────────────────────────────────────────────────────────

static std::vector<Vec2> smoothPath(
    const std::vector<Vec2>& path,
    const std::vector<bool>& blocked)
{
    if (path.size() <= 2) return path;

    std::vector<Vec2> result;
    result.push_back(path.front());
    std::size_t anchor = 0;

    for (std::size_t i = 2; i < path.size(); ++i) {
        if (!hasLOS(path[anchor], path[i], blocked)) {
            result.push_back(path[i - 1]);
            anchor = i - 1;
        }
    }
    result.push_back(path.back());
    return result;
}

// ─── A* search ───────────────────────────────────────────────────────────────

std::vector<Vec2> computeAstarPath(const PathRequest& req) {
    const auto blocked = buildBlockedMap(req.obstacles);

    int sx = normToCell(req.ship.x), sy = normToCell(req.ship.y);
    int gx = normToCell(req.goal.x), gy = normToCell(req.goal.y);
    int startIdx = cellIdx(sx, sy);
    int goalIdx  = cellIdx(gx, gy);

    // Fallback: direct path if start == goal.
    if (startIdx == goalIdx) {
        return { req.ship, req.goal };
    }

    // g-scores and came-from.
    std::vector<double> gScore(TOTAL_CELLS, std::numeric_limits<double>::infinity());
    std::vector<int>    cameFrom(TOTAL_CELLS, -1);

    // Min-heap: (f, idx).
    using Node = std::pair<double, int>;
    std::priority_queue<Node, std::vector<Node>, std::greater<Node>> open;

    gScore[startIdx] = 0.0;
    open.push({ heuristic(startIdx, gx, gy), startIdx });

    bool found = false;

    while (!open.empty()) {
        auto [f, current] = open.top();
        open.pop();

        // Stale entry check.
        if (f > gScore[current] + heuristic(current, gx, gy) + 1e-9) continue;

        if (current == goalIdx) { found = true; break; }

        int cx = current % GRID_N;
        int cy = current / GRID_N;

        for (const auto& move : MOVES) {
            int nx = cx + move.dx;
            int ny = cy + move.dy;
            if (nx < 0 || nx >= GRID_N || ny < 0 || ny >= GRID_N) continue;
            int nIdx = cellIdx(nx, ny);
            if (blocked[nIdx]) continue;

            double tentG = gScore[current] + move.cost;
            if (tentG < gScore[nIdx]) {
                gScore[nIdx]   = tentG;
                cameFrom[nIdx] = current;
                open.push({ tentG + heuristic(nIdx, gx, gy), nIdx });
            }
        }
    }

    if (!found) {
        // No path found — return direct line.
        return { req.ship, req.goal };
    }

    // Reconstruct raw path.
    std::vector<Vec2> raw;
    for (int cur = goalIdx; cur != -1; cur = cameFrom[cur]) {
        raw.push_back({ cellToNorm(cur % GRID_N), cellToNorm(cur / GRID_N) });
    }
    std::reverse(raw.begin(), raw.end());

    // Replace first/last with exact coordinates.
    if (!raw.empty())       raw.front() = req.ship;
    if (raw.size() > 1)     raw.back()  = req.goal;

    return smoothPath(raw, blocked);
}

} // namespace daa
