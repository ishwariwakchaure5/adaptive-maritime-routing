#pragma once
#include "types.h"

namespace daa {

/**
 * Runs A* on an 80×80 uniform grid in [0,1]² normalized space.
 *
 * Obstacles are inflated by SHIP_CLEARANCE so the returned path keeps
 * the ship clear of obstacle edges.
 *
 * Returns a smoothed path from ship to goal as a list of Vec2 waypoints.
 * If no path is found, returns a direct two-point path [ship, goal].
 */
std::vector<Vec2> computeAstarPath(const PathRequest& req);

} // namespace daa
