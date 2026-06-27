#include "step_simulator.h"

#include <algorithm>
#include <cmath>

namespace daa {

// ─── Helpers (duplicated from vector_field.cpp to keep modules independent) ──

static inline double clamp01(double v) {
    return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

static inline double len2(double dx, double dy) {
    return std::sqrt(dx * dx + dy * dy);
}

static void attractiveForce(
    double px, double py, double gx, double gy, double kAtt,
    double& outX, double& outY)
{
    double dx = gx - px, dy = gy - py;
    double d  = len2(dx, dy);
    if (d < 1e-12) { outX = outY = 0.0; return; }
    double scale = kAtt * std::min(1.0, d);
    outX = (dx / d) * scale;
    outY = (dy / d) * scale;
}

static void repulsiveForce(
    double px, double py,
    const std::vector<Obstacle>& obstacles,
    double kRep, double influenceRadius, double minDist,
    double& outX, double& outY)
{
    outX = outY = 0.0;
    const double invIR = 1.0 / influenceRadius;
    for (const auto& obs : obstacles) {
        double dx = px - obs.x, dy = py - obs.y;
        double d  = len2(dx, dy);
        if (d >= influenceRadius) continue;
        double dSafe = std::max(d, minDist);
        double mag   = kRep * (1.0 / dSafe - invIR) / (dSafe * dSafe);
        double l     = len2(dx, dy);
        if (l < 1e-12) continue;
        outX += (dx / l) * mag;
        outY += (dy / l) * mag;
    }
}

static int nearestObstacle(
    double px, double py,
    const std::vector<Obstacle>& obstacles,
    double influenceRadius)
{
    int best = -1; double bestD = influenceRadius;
    for (int i = 0; i < (int)obstacles.size(); ++i) {
        double d = len2(px - obstacles[i].x, py - obstacles[i].y);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

static void tangentialEscape(
    double px, double py, double gx, double gy,
    const std::vector<Obstacle>& obstacles, double influenceRadius,
    double& outX, double& outY)
{
    double tgLen = len2(gx - px, gy - py);
    double gdx = (tgLen > 1e-12) ? (gx - px) / tgLen : 1.0;
    double gdy = (tgLen > 1e-12) ? (gy - py) / tgLen : 0.0;

    int idx = nearestObstacle(px, py, obstacles, influenceRadius);
    if (idx >= 0) {
        double rx = px - obstacles[idx].x, ry = py - obstacles[idx].y;
        double rLen = len2(rx, ry);
        double rux = (rLen > 1e-12) ? rx / rLen : 1.0;
        double ruy = (rLen > 1e-12) ? ry / rLen : 0.0;
        double tAx = -ruy, tAy = rux, tBx = ruy, tBy = -rux;
        double dotA = tAx * gdx + tAy * gdy, dotB = tBx * gdx + tBy * gdy;
        double tx = (dotA >= dotB) ? tAx : tBx;
        double ty = (dotA >= dotB) ? tAy : tBy;
        double tLen = len2(tx, ty);
        outX = (tLen > 1e-12) ? tx / tLen : 0.0;
        outY = (tLen > 1e-12) ? ty / tLen : 1.0;
    } else {
        double pLen = len2(-gdy, gdx);
        outX = (pLen > 1e-12) ? -gdy / pLen : 0.0;
        outY = (pLen > 1e-12) ?  gdx / pLen : 1.0;
    }
}

static void smoothHeading(
    double hx, double hy, double dx, double dy, double maxTurn,
    double& outX, double& outY)
{
    double dLen = len2(dx, dy);
    if (dLen < 1e-9) { outX = hx; outY = hy; return; }
    double ndx = dx / dLen, ndy = dy / dLen;
    double dot = hx * ndx + hy * ndy, cross = hx * ndy - hy * ndx;
    double angle   = std::atan2(cross, dot);
    double clamped = std::max(-maxTurn, std::min(maxTurn, angle));
    if (std::abs(clamped - angle) < 1e-9) { outX = ndx; outY = ndy; return; }
    double cosA = std::cos(clamped), sinA = std::sin(clamped);
    double nx = hx * cosA - hy * sinA, ny = hx * sinA + hy * cosA;
    double nLen = len2(nx, ny);
    if (nLen < 1e-12) { outX = hx; outY = hy; return; }
    outX = nx / nLen; outY = ny / nLen;
}

static inline double smoothstep01(double t) {
    t = std::max(0.0, std::min(1.0, t));
    return t * t * (3.0 - 2.0 * t);
}

// ─── Single step ──────────────────────────────────────────────────────────────

StepResponse simulateStep(const StepRequest& req, const VfConfig& cfg) {
    StepResponse resp;
    resp.navState = req.navState;   // copy, then mutate

    double px = req.ship.x, py = req.ship.y;
    double gx = req.goal.x, gy = req.goal.y;

    double distToGoal = len2(gx - px, gy - py);
    resp.distToGoal   = distToGoal;

    // ── Goal reached? ─────────────────────────────────────────────────────────
    if (distToGoal <= cfg.goalThreshold) {
        resp.position    = req.goal;
        resp.reachedGoal = true;
        return resp;
    }

    // ── Goal-capture zone ─────────────────────────────────────────────────────
    const double captureZone = cfg.stepSize * 3.0;
    if (distToGoal <= captureZone) {
        double s = std::min(cfg.stepSize, distToGoal);
        resp.position = { clamp01(px + (gx - px) / distToGoal * s),
                          clamp01(py + (gy - py) / distToGoal * s) };
        resp.reachedGoal = (len2(resp.position.x - gx, resp.position.y - gy) <= cfg.goalThreshold);
        return resp;
    }

    // ── Attractive + repulsive forces ─────────────────────────────────────────
    double fax, fay, frx, fry;
    attractiveForce(px, py, gx, gy, cfg.kAtt, fax, fay);
    repulsiveForce(px, py, req.obstacles, cfg.kRep, cfg.influenceRadius, cfg.minRepulsionDist, frx, fry);

    double ftx = fax + frx, fty = fay + fry;

    // ── Stuck detection ───────────────────────────────────────────────────────
    double goalDot = (ftx * (gx - px) + fty * (gy - py))
                   / (len2(ftx, fty) * distToGoal + 1e-12);
    if (goalDot < 0.05) {
        resp.navState.stuckFrames++;
    } else {
        resp.navState.stuckFrames = std::max(0, resp.navState.stuckFrames - 2);
    }

    // ── Escape bias ───────────────────────────────────────────────────────────
    if (resp.navState.stuckFrames >= cfg.escapeMinSteps) {
        double ex, ey;
        tangentialEscape(px, py, gx, gy, req.obstacles, cfg.influenceRadius, ex, ey);

        const double alpha = 0.12;
        if (!resp.navState.escapeInitialized) {
            resp.navState.escapeX = ex;
            resp.navState.escapeY = ey;
            resp.navState.escapeInitialized = true;
        } else {
            resp.navState.escapeX = resp.navState.escapeX * (1.0 - alpha) + ex * alpha;
            resp.navState.escapeY = resp.navState.escapeY * (1.0 - alpha) + ey * alpha;
            double eLen = len2(resp.navState.escapeX, resp.navState.escapeY);
            if (eLen > 1e-12) { resp.navState.escapeX /= eLen; resp.navState.escapeY /= eLen; }
        }

        double rampT   = (double)(resp.navState.stuckFrames - cfg.escapeMinSteps) / (double)cfg.escapeRampSteps;
        double strength = smoothstep01(rampT);
        double bonus    = strength * cfg.escapeGain * cfg.kAtt;
        ftx += resp.navState.escapeX * bonus;
        fty += resp.navState.escapeY * bonus;
    } else {
        resp.navState.escapeInitialized = false;
    }

    // ── Normalize + heading smooth ────────────────────────────────────────────
    double fLen = len2(ftx, fty);
    double desiredDx = (fLen > 1e-12) ? ftx / fLen : (gx - px) / distToGoal;
    double desiredDy = (fLen > 1e-12) ? fty / fLen : (gy - py) / distToGoal;

    double newHx, newHy;
    smoothHeading(req.navState.headingX, req.navState.headingY,
                  desiredDx, desiredDy, cfg.maxTurnRad, newHx, newHy);
    resp.navState.headingX = newHx;
    resp.navState.headingY = newHy;

    // ── Move ──────────────────────────────────────────────────────────────────
    double actualStep = std::min(cfg.stepSize, distToGoal);
    resp.position = { clamp01(px + newHx * actualStep),
                      clamp01(py + newHy * actualStep) };

    resp.distToGoal  = len2(resp.position.x - gx, resp.position.y - gy);
    resp.reachedGoal = (resp.distToGoal <= cfg.goalThreshold);
    if (resp.reachedGoal) resp.position = req.goal;

    return resp;
}

} // namespace daa
