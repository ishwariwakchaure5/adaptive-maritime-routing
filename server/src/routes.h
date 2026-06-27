#pragma once
#include <crow.h>

namespace daa {

/**
 * Registers all HTTP routes on the given Crow app.
 * Call this once before app.run().
 */
void registerRoutes(crow::SimpleApp& app);

} // namespace daa
