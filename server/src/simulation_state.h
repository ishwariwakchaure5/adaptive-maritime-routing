#pragma once
#include "types.h"

namespace daa {

/**
 * Per-ship mutable navigation state carried between step calls.
 * The client sends this with every /simulate-step request and receives
 * the updated version back — the server is fully stateless.
 */
struct ShipNavState {
    /** Current smoothed heading unit vector. */
    double headingX{1.0};
    double headingY{0.0};

    /** Consecutive frames the ship has been considered "stuck". */
    int stuckFrames{0};

    /** Smoothed escape direction (EMA). */
    double escapeX{0.0};
    double escapeY{0.0};
    bool   escapeInitialized{false};
};

/**
 * Input for a single simulation step.
 */
struct StepRequest {
    Vec2                  ship;       ///< Current position
    Vec2                  goal;       ///< Target position
    std::vector<Obstacle> obstacles;
    ShipNavState          navState;   ///< Mutable navigation state
};

/**
 * Output of a single simulation step.
 */
struct StepResponse {
    Vec2         position;    ///< New ship position after this step
    ShipNavState navState;    ///< Updated navigation state (send back next call)
    bool         reachedGoal{false};
    double       distToGoal{0.0};
};

} // namespace daa
