#include <crow.h>
#include "routes.h"

int main() {
    crow::SimpleApp app;

    // Register all routes (including OPTIONS preflight for CORS).
    daa::registerRoutes(app);

    const uint16_t PORT = 8080;
    CROW_LOG_INFO << "DAA path server starting on port " << PORT;

    app
        .port(PORT)
        .multithreaded()
        .run();

    return 0;
}
