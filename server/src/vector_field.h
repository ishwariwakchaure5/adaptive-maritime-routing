#pragma once
#include "types.h"

namespace daa {

/**
 * Tunable parameters for the Vector Field (APF) path planner.
 * All distances are in normalized [0,1]² space.
 */
struct VfConfig {
    // ── Force weights ─────────────────────────────────────────────────────────
    /** Attractive gain — scales the pull toward the goal. */
    double kAtt{12.0};

    /**
     * Repulsive gain — scales the push away from obstacles.
     * Uses the standard APF formula: kRep * (1/d - 1/R) / d²
     * which goes smoothly to zero at influenceRadius.
     */
    double kRep{0.0015};

    // ── Geometry ──────────────────────────────────────────────────────────────
    /** Obstacles only repel when the ship is closer than this distance. */
    double influenceRadius{0.18};

    /** Floor on obstacle distance to prevent division-by-zero singularities. */
    double minRepulsionDist{0.01};

    // ── Stepping ──────────────────────────────────────────────────────────────
    /** Distance moved per iteration (normalized units). */
    double stepSize{0.0018};

    /** Ship is considered arrived when within this distance of the goal. */
    double goalThreshold{0.028};

    // ── Heading smoothing ─────────────────────────────────────────────────────
    /**
     * Maximum heading change per step (radians).
     * Limits how sharply the ship can turn — produces smooth arcs.
     * ~4.5° per step at default step size.
     */
    double maxTurnRad{0.078};

    // ── Local-minima escape ───────────────────────────────────────────────────
    /**
     * Steps below the stuck-speed threshold before escape bias activates.
     * Lower = faster response to being stuck.
     */
    int escapeMinSteps{18};

    /**
     * Steps over which escape strength ramps from 0 → 1 after activation.
     */
    int escapeRampSteps{30};

    /** Escape force gain relative to kAtt. */
    double escapeGain{0.65};

    // ── Safety ────────────────────────────────────────────────────────────────
    /** Hard cap on iterations — prevents infinite loops. */
    int maxIterations{8000};

    /**
     * Speed (step distance) below which the ship is considered stuck.
     * Normalized units per step.
     */
    double stuckSpeedThreshold{0.00016};
};

/**
 * Runs the Vector Field (Artificial Potential Field) path planner.
 *
 * Iteratively moves the ship from req.ship toward req.goal by:
 *   1. Computing F_att = kAtt * (goal - pos)          [attractive]
 *   2. Computing F_rep = sum of obstacle repulsions    [repulsive]
 *   3. Adding tangential escape bias when stuck        [local-minima recovery]
 *   4. Normalizing F_total and stepping by stepSize    [movement]
 *   5. Applying heading smoothing (turn-rate limit)    [smooth arcs]
 *
 * Stops when the ship reaches goalThreshold of the goal, or after
 * maxIterations steps (whichever comes first).
 *
 * @param req     Input: ship start, goal, and obstacle list.
 * @param config  Tunable parameters (optional — defaults are well-tuned).
 * @return        Waypoints from start to goal (or as far as reached).
 */
std::vector<Vec2> computeVfPath(
    const PathRequest& req,
    const VfConfig&    config = VfConfig{});

} // namespace daa
