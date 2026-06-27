#include "routes.h"
#include "astar.h"
#include "vector_field.h"
#include "step_simulator.h"
#include "types.h"

#include <chrono>
#include <nlohmann/json.hpp>
#include <crow.h>

using json    = nlohmann::json;
using clock_t = std::chrono::steady_clock;

namespace daa {

// ─────────────────────────────────────────────────────────────────────────────
// JSON helpers
// ─────────────────────────────────────────────────────────────────────────────

static Vec2 parseVec2(const json& j) {
    return { j.at("x").get<double>(), j.at("y").get<double>() };
}

static Obstacle parseObstacle(const json& j) {
    return {
        j.at("x").get<double>(),
        j.at("y").get<double>(),
        j.at("radius").get<double>()
    };
}

static PathRequest parseRequest(const json& body) {
    PathRequest req;
    req.ship = parseVec2(body.at("ship"));
    req.goal = parseVec2(body.at("goal"));
    if (body.contains("obstacles") && body["obstacles"].is_array()) {
        req.obstacles.reserve(body["obstacles"].size());
        for (const auto& obs : body["obstacles"])
            req.obstacles.push_back(parseObstacle(obs));
    }
    return req;
}

static VfConfig parseVfConfig(const json& body) {
    VfConfig cfg;
    if (!body.contains("config") || !body["config"].is_object()) return cfg;
    const auto& c = body["config"];
    auto getD = [&](const char* k, double& v) { if (c.contains(k) && c[k].is_number()) v = c[k].get<double>(); };
    auto getI = [&](const char* k, int&    v) { if (c.contains(k) && c[k].is_number_integer()) v = c[k].get<int>(); };
    getD("kAtt",            cfg.kAtt);
    getD("kRep",            cfg.kRep);
    getD("influenceRadius", cfg.influenceRadius);
    getD("minRepulsionDist",cfg.minRepulsionDist);
    getD("stepSize",        cfg.stepSize);
    getD("goalThreshold",   cfg.goalThreshold);
    getD("maxTurnRad",      cfg.maxTurnRad);
    getD("escapeGain",      cfg.escapeGain);
    getI("escapeMinSteps",  cfg.escapeMinSteps);
    getI("escapeRampSteps", cfg.escapeRampSteps);
    getI("maxIterations",   cfg.maxIterations);
    return cfg;
}

/** Parses ShipNavState from an optional "navState" sub-object. */
static ShipNavState parseNavState(const json& body) {
    ShipNavState ns;
    if (!body.contains("navState") || !body["navState"].is_object()) return ns;
    const auto& n = body["navState"];
    if (n.contains("headingX") && n["headingX"].is_number()) ns.headingX = n["headingX"].get<double>();
    if (n.contains("headingY") && n["headingY"].is_number()) ns.headingY = n["headingY"].get<double>();
    if (n.contains("stuckFrames") && n["stuckFrames"].is_number_integer()) ns.stuckFrames = n["stuckFrames"].get<int>();
    if (n.contains("escapeX") && n["escapeX"].is_number()) ns.escapeX = n["escapeX"].get<double>();
    if (n.contains("escapeY") && n["escapeY"].is_number()) ns.escapeY = n["escapeY"].get<double>();
    if (n.contains("escapeInitialized") && n["escapeInitialized"].is_boolean()) ns.escapeInitialized = n["escapeInitialized"].get<bool>();
    return ns;
}

static json vec2ToJson(const Vec2& v) { return { {"x", v.x}, {"y", v.y} }; }

static json navStateToJson(const ShipNavState& ns) {
    return {
        {"headingX",          ns.headingX},
        {"headingY",          ns.headingY},
        {"stuckFrames",       ns.stuckFrames},
        {"escapeX",           ns.escapeX},
        {"escapeY",           ns.escapeY},
        {"escapeInitialized", ns.escapeInitialized}
    };
}

static json pathToJson(const std::vector<Vec2>& path) {
    json arr = json::array();
    arr.get_ref<json::array_t&>().reserve(path.size());
    for (const auto& pt : path) arr.push_back(vec2ToJson(pt));
    return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

static bool inRange(double v) { return v >= 0.0 && v <= 1.0; }

static std::string validateRequest(const PathRequest& req) {
    if (!inRange(req.ship.x) || !inRange(req.ship.y)) return "ship x/y must be in [0,1].";
    if (!inRange(req.goal.x) || !inRange(req.goal.y)) return "goal x/y must be in [0,1].";
    for (std::size_t i = 0; i < req.obstacles.size(); ++i) {
        const auto& o = req.obstacles[i];
        if (!inRange(o.x) || !inRange(o.y))
            return "obstacles[" + std::to_string(i) + "] x/y must be in [0,1].";
        if (o.radius <= 0.0)
            return "obstacles[" + std::to_string(i) + "].radius must be > 0.";
    }
    return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────

static crow::response jsonResponse(int status, json body) {
    crow::response res(status, body.dump());
    res.set_header("Content-Type",                "application/json");
    res.set_header("Access-Control-Allow-Origin", "*");
    return res;
}

static crow::response errorResponse(int status, const std::string& msg) {
    return jsonResponse(status, { {"error", msg} });
}

static crow::response corsPreflightResponse() {
    crow::response res(204);
    res.set_header("Access-Control-Allow-Origin",  "*");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
    return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm dispatch (full path)
// ─────────────────────────────────────────────────────────────────────────────

static json runAlgorithm(const std::string& algo, const PathRequest& req, const VfConfig& vfCfg) {
    if (algo == "astar") {
        auto t0 = clock_t::now();
        auto path = computeAstarPath(req);
        double ms = std::chrono::duration<double, std::milli>(clock_t::now() - t0).count();
        return { {"path", pathToJson(path)}, {"algorithm","astar"}, {"steps",(int)path.size()}, {"computeMs",ms} };
    }
    auto t0 = clock_t::now();
    auto path = computeVfPath(req, vfCfg);
    double ms = std::chrono::duration<double, std::milli>(clock_t::now() - t0).count();
    return { {"path", pathToJson(path)}, {"algorithm","vector_field"}, {"steps",(int)path.size()}, {"computeMs",ms} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

void registerRoutes(crow::SimpleApp& app) {

    // ── GET /health ───────────────────────────────────────────────────────────
    CROW_ROUTE(app, "/health")
    ([]() {
        return jsonResponse(200, {
            {"status",  "ok"},
            {"service", "daa-path-server"},
            {"endpoints", json::array({"/health", "/compute-path", "/simulate-step", "/ws"})}
        });
    });

    // ── OPTIONS /compute-path ─────────────────────────────────────────────────
    CROW_ROUTE(app, "/compute-path").methods(crow::HTTPMethod::OPTIONS)
    ([]() { return corsPreflightResponse(); });

    // ── POST /compute-path ────────────────────────────────────────────────────
    // Returns the full pre-computed path (batch mode).
    CROW_ROUTE(app, "/compute-path").methods(crow::HTTPMethod::POST)
    ([](const crow::request& req) -> crow::response {
        json body;
        try { body = json::parse(req.body); }
        catch (const json::parse_error& e) { return errorResponse(400, std::string("Invalid JSON: ") + e.what()); }

        PathRequest pathReq;
        try { pathReq = parseRequest(body); }
        catch (const json::exception& e) { return errorResponse(400, std::string("Missing field: ") + e.what()); }

        auto err = validateRequest(pathReq);
        if (!err.empty()) return errorResponse(400, err);

        const VfConfig vfCfg = parseVfConfig(body);

        std::string algo = "vector_field";
        if (body.contains("algorithm") && body["algorithm"].is_string())
            algo = body["algorithm"].get<std::string>();

        if (algo != "vector_field" && algo != "astar" && algo != "both")
            return errorResponse(400, "algorithm must be \"vector_field\", \"astar\", or \"both\".");

        if (algo == "both") {
            return jsonResponse(200, {
                {"vector_field", runAlgorithm("vector_field", pathReq, vfCfg)},
                {"astar",        runAlgorithm("astar",        pathReq, vfCfg)}
            });
        }
        return jsonResponse(200, runAlgorithm(algo, pathReq, vfCfg));
    });

    // ── OPTIONS /simulate-step ────────────────────────────────────────────────
    CROW_ROUTE(app, "/simulate-step").methods(crow::HTTPMethod::OPTIONS)
    ([]() { return corsPreflightResponse(); });

    // ── POST /simulate-step ───────────────────────────────────────────────────
    //
    // Stateless single-step endpoint for real-time simulation.
    // The client sends the current ship state and receives the next position.
    // All mutable navigation state is round-tripped in the JSON so the server
    // never needs to store sessions.
    //
    // Request:
    // {
    //   "ship":     { "x": number, "y": number },
    //   "goal":     { "x": number, "y": number },
    //   "obstacles":[{ "x": number, "y": number, "radius": number }],
    //   "navState": {                          // optional on first call
    //     "headingX": number, "headingY": number,
    //     "stuckFrames": number,
    //     "escapeX": number, "escapeY": number,
    //     "escapeInitialized": boolean
    //   },
    //   "config": { ... VfConfig overrides ... }  // optional
    // }
    //
    // Response:
    // {
    //   "position":    { "x": number, "y": number },
    //   "navState":    { ... updated nav state ... },
    //   "reachedGoal": boolean,
    //   "distToGoal":  number
    // }
    //
    CROW_ROUTE(app, "/simulate-step").methods(crow::HTTPMethod::POST)
    ([](const crow::request& req) -> crow::response {
        json body;
        try { body = json::parse(req.body); }
        catch (const json::parse_error& e) { return errorResponse(400, std::string("Invalid JSON: ") + e.what()); }

        PathRequest pathReq;
        try { pathReq = parseRequest(body); }
        catch (const json::exception& e) { return errorResponse(400, std::string("Missing field: ") + e.what()); }

        auto err = validateRequest(pathReq);
        if (!err.empty()) return errorResponse(400, err);

        StepRequest stepReq;
        stepReq.ship      = pathReq.ship;
        stepReq.goal      = pathReq.goal;
        stepReq.obstacles = pathReq.obstacles;
        stepReq.navState  = parseNavState(body);

        const VfConfig cfg = parseVfConfig(body);
        const StepResponse resp = simulateStep(stepReq, cfg);

        return jsonResponse(200, {
            {"position",    vec2ToJson(resp.position)},
            {"navState",    navStateToJson(resp.navState)},
            {"reachedGoal", resp.reachedGoal},
            {"distToGoal",  resp.distToGoal}
        });
    });

    // ── WebSocket /ws ─────────────────────────────────────────────────────────
    //
    // Real-time step-by-step simulation over WebSocket.
    // The client sends the same JSON as /simulate-step each frame and receives
    // the same response — but without HTTP overhead per step.
    //
    // This is the preferred mode for smooth real-time animation.
    //
    CROW_WEBSOCKET_ROUTE(app, "/ws")
    .onopen([](crow::websocket::connection& conn) {
        CROW_LOG_INFO << "[ws] client connected: " << &conn;
    })
    .onclose([](crow::websocket::connection& conn, const std::string& reason, uint16_t) {
        CROW_LOG_INFO << "[ws] client disconnected: " << &conn << " reason=" << reason;
    })
    .onmessage([](crow::websocket::connection& conn, const std::string& data, bool /*isBinary*/) {
        json body;
        try { body = json::parse(data); }
        catch (...) {
            conn.send_text(json{ {"error", "Invalid JSON"} }.dump());
            return;
        }

        PathRequest pathReq;
        try { pathReq = parseRequest(body); }
        catch (const json::exception& e) {
            conn.send_text(json{ {"error", std::string("Missing field: ") + e.what()} }.dump());
            return;
        }

        auto err = validateRequest(pathReq);
        if (!err.empty()) {
            conn.send_text(json{ {"error", err} }.dump());
            return;
        }

        StepRequest stepReq;
        stepReq.ship      = pathReq.ship;
        stepReq.goal      = pathReq.goal;
        stepReq.obstacles = pathReq.obstacles;
        stepReq.navState  = parseNavState(body);

        const VfConfig cfg = parseVfConfig(body);
        const StepResponse resp = simulateStep(stepReq, cfg);

        conn.send_text(json{
            {"position",    vec2ToJson(resp.position)},
            {"navState",    navStateToJson(resp.navState)},
            {"reachedGoal", resp.reachedGoal},
            {"distToGoal",  resp.distToGoal}
        }.dump());
    });
}

} // namespace daa
