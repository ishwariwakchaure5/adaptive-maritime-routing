#pragma once
#include "simulation_state.h"
#include "vector_field.h"

namespace daa {

/**
 * Advances the ship by exactly one VF step.
 *
 * This is the stateless single-step version of computeVfPath().
 * All mutable navigation state (heading, stuck counter, escape direction)
 * is passed in and returned so the server never needs to store session data.
 *
 * @param req    Current ship position, goal, obstacles, and nav state.
 * @param cfg    VF tuning parameters.
 * @return       New position, updated nav state, and goal-reached flag.
 */
StepResponse simulateStep(const StepRequest& req, const VfConfig& cfg = VfConfig{});

} // namespace daa
