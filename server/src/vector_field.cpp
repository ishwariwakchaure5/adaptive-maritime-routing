#include "vector_field.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace daa {

// ─── Scalar math helpers ──────────────────────────────────────────────────────

static inline double clamp01(double v) {
    return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

static inline double hypot2(double dx, double dy) {
    return std::sqrt(dx * dx + dy * dy);
}

// ─── Attractive force ─────────────────────────────────────────────────────────

/**
 * F_att = kAtt * (goal - pos)
 *
 * Linear attraction — magnitude grows with distance so the ship accelerates
 * when far from the goal and decelerates as it approaches.
 * Capped at kAtt to prevent unbounded growth far from the goal.
 */
static void attractiveForce(
    double px, double py,
    double gx, double gy,
    double kAtt,
    double& outX, double& outY)
{
    double dx   = gx - px;
    double dy   = gy - py;
    double dist = hypot2(dx, dy);

    // Scale: linear up to distance 1, capped beyond.
    double scale = kAtt * std::min(1.0, dist);
    if (dist < 1e-12) { outX = outY = 0.0; return; }

    outX = (dx / dist) * scale;
    outY = (dy / dist) * scale;
}

// ─── Repulsive force ──────────────────────────────────────────────────────────

/**
 * Standard APF repulsion from a single obstacle:
 *   F_rep = kRep * (1/d - 1/R) / d²  * unit_away
 *
 * Goes smoothly to zero at d == influenceRadius (no discontinuity).
 * Grows strongly as d → 0, clamped by minRepulsionDist.
 */
static void repulsiveForceFromObstacle(
    double px, double py,
    const Obstacle& obs,
    double kRep,
    double influenceRadius,
    double minRepulsionDist,
    double& outX, double& outY)
{
    double dx   = px - obs.x;
    double dy   = py - obs.y;
    double dist = hypot2(dx, dy);

    if (dist >= influenceRadius) { outX = outY = 0.0; return; }

    double dSafe = std::max(dist, minRepulsionDist);
    double invIR = 1.0 / influenceRadius;
    double mag   = kRep * (1.0 / dSafe - invIR) / (dSafe * dSafe);

    double len = hypot2(dx, dy);
    if (len < 1e-12) { outX = outY = 0.0; return; }

    outX = (dx / len) * mag;
    outY = (dy / len) * mag;
}

/**
 * Sum repulsive forces from all obstacles.
 */
static void sumRepulsiveForces(
    double px, double py,
    const std::vector<Obstacle>& obstacles,
    double kRep,
    double influenceRadius,
    double minRepulsionDist,
    double& outX, double& outY)
{
    outX = outY = 0.0;
    for (const auto& obs : obstacles) {
        double rx, ry;
        repulsiveForceFromObstacle(px, py, obs, kRep, influenceRadius, minRepulsionDist, rx, ry);
        outX += rx;
        outY += ry;
    }
}

// ─── Local-minima escape ──────────────────────────────────────────────────────

/**
 * Finds the nearest obstacle within influenceRadius.
 * Returns its index, or -1 if none found.
 */
static int nearestObstacleIdx(
    double px, double py,
    const std::vector<Obstacle>& obstacles,
    double influenceRadius)
{
    int    best  = -1;
    double bestD = influenceRadius;

    for (int i = 0; i < static_cast<int>(obstacles.size()); ++i) {
        double dx = px - obstacles[i].x;
        double dy = py - obstacles[i].y;
        double d  = hypot2(dx, dy);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/**
 * Computes the tangential escape direction — the perpendicular to the
 * radial direction from the nearest obstacle that points most toward the goal.
 *
 * This slides the ship around the obstacle rather than pushing it randomly,
 * giving deterministic, goal-directed local-minima recovery.
 */
static void tangentialEscapeDir(
    double px, double py,
    double gx, double gy,
    const std::vector<Obstacle>& obstacles,
    double influenceRadius,
    double& outX, double& outY)
{
    // Goal direction.
    double tgx = gx - px, tgy = gy - py;
    double tgLen = hypot2(tgx, tgy);
    double gdx = (tgLen > 1e-12) ? tgx / tgLen : 1.0;
    double gdy = (tgLen > 1e-12) ? tgy / tgLen : 0.0;

    int idx = nearestObstacleIdx(px, py, obstacles, influenceRadius);

    if (idx >= 0) {
        // Radial unit vector away from obstacle.
        double rx  = px - obstacles[idx].x;
        double ry  = py - obstacles[idx].y;
        double rLen = hypot2(rx, ry);
        double rux = (rLen > 1e-12) ? rx / rLen : 1.0;
        double ruy = (rLen > 1e-12) ? ry / rLen : 0.0;

        // Two perpendiculars to the radial direction.
        double tAx = -ruy, tAy =  rux;
        double tBx =  ruy, tBy = -rux;

        // Pick the one that points more toward the goal.
        double dotA = tAx * gdx + tAy * gdy;
        double dotB = tBx * gdx + tBy * gdy;
        double tx = (dotA >= dotB) ? tAx : tBx;
        double ty = (dotA >= dotB) ? tAy : tBy;

        double tLen = hypot2(tx, ty);
        outX = (tLen > 1e-12) ? tx / tLen : 0.0;
        outY = (tLen > 1e-12) ? ty / tLen : 1.0;
    } else {
        // No nearby obstacle — nudge perpendicular to goal direction.
        double perpLen = hypot2(-gdy, gdx);
        outX = (perpLen > 1e-12) ? -gdy / perpLen : 0.0;
        outY = (perpLen > 1e-12) ?  gdx / perpLen : 1.0;
    }
}

// ─── Heading smoothing ────────────────────────────────────────────────────────

/**
 * Rotates heading (hx, hy) toward desired direction (dx, dy) by at most
 * maxTurn radians. Returns the new heading via outX/outY.
 *
 * Uses dot/cross products to find the signed angle, then clamps it.
 * No trigonometry needed for the common case (angle < maxTurn).
 */
static void smoothHeading(
    double hx, double hy,
    double dx, double dy,
    double maxTurn,
    double& outX, double& outY)
{
    double desiredLen = hypot2(dx, dy);
    if (desiredLen < 1e-9) { outX = hx; outY = hy; return; }

    double ndx = dx / desiredLen;
    double ndy = dy / desiredLen;

    double dot   =  hx * ndx + hy * ndy;   // cos θ
    double cross =  hx * ndy - hy * ndx;   // sin θ

    double angle   = std::atan2(cross, dot);
    double clamped = std::max(-maxTurn, std::min(maxTurn, angle));

    if (std::abs(clamped - angle) < 1e-9) {
        // No clamping needed.
        outX = ndx; outY = ndy; return;
    }

    // Rotate current heading by clamped radians.
    double cosA = std::cos(clamped);
    double sinA = std::sin(clamped);
    double nx   = hx * cosA - hy * sinA;
    double ny   = hx * sinA + hy * cosA;
    double nLen = hypot2(nx, ny);
    if (nLen < 1e-12) { outX = hx; outY = hy; return; }
    outX = nx / nLen;
    outY = ny / nLen;
}

// ─── Smoothstep ───────────────────────────────────────────────────────────────

static inline double smoothstep01(double t) {
    t = std::max(0.0, std::min(1.0, t));
    return t * t * (3.0 - 2.0 * t);
}

// ─── Main VF path computation ─────────────────────────────────────────────────

std::vector<Vec2> computeVfPath(const PathRequest& req, const VfConfig& cfg) {
    std::vector<Vec2> path;
    path.reserve(512);

    double px = req.ship.x;
    double py = req.ship.y;
    const double gx = req.goal.x;
    const double gy = req.goal.y;

    // Record starting position.
    path.push_back({px, py});

    // Initial heading toward goal.
    double hdx = gx - px, hdy = gy - py;
    double hdLen = hypot2(hdx, hdy);
    if (hdLen > 1e-12) { hdx /= hdLen; hdy /= hdLen; }
    else               { hdx = 1.0;    hdy = 0.0;    }

    // Escape state.
    int    stuckFrames       = 0;
    double smoothedEscapeX   = 0.0;
    double smoothedEscapeY   = 0.0;
    bool   escapeInitialized = false;

    // Minimum squared distance to record a new path point.
    const double minRecordDist2 = 1e-7;

    for (int iter = 0; iter < cfg.maxIterations; ++iter) {

        // ── Check goal arrival ────────────────────────────────────────────────
        double sepX = px - gx, sepY = py - gy;
        double distToGoal = hypot2(sepX, sepY);

        if (distToGoal <= cfg.goalThreshold) {
            path.push_back({gx, gy});
            break;
        }

        // ── Goal-capture zone: snap directly, skip all forces ─────────────────
        const double captureZone = cfg.stepSize * 3.0;
        if (distToGoal <= captureZone) {
            double s = std::min(cfg.stepSize, distToGoal);
            px = clamp01(px + (gx - px) / distToGoal * s);
            py = clamp01(py + (gy - py) / distToGoal * s);
            path.push_back({px, py});
            continue;
        }

        // ── Attractive force ──────────────────────────────────────────────────
        double fax, fay;
        attractiveForce(px, py, gx, gy, cfg.kAtt, fax, fay);

        // ── Repulsive force ───────────────────────────────────────────────────
        double frx, fry;
        sumRepulsiveForces(px, py, req.obstacles,
                           cfg.kRep, cfg.influenceRadius, cfg.minRepulsionDist,
                           frx, fry);

        // ── Total force ───────────────────────────────────────────────────────
        double ftx = fax + frx;
        double fty = fay + fry;

        // ── Local-minima escape ───────────────────────────────────────────────
        // Track speed (distance moved last step).
        double speed = hypot2(hdx * cfg.stepSize, hdy * cfg.stepSize);
        // Approximate: use repulsive force magnitude as stuck indicator.
        // A ship is stuck when it barely moves — detected by checking whether
        // the total force direction is nearly opposite to the goal direction.
        double goalDot = (ftx * (gx - px) + fty * (gy - py))
                       / (hypot2(ftx, fty) * distToGoal + 1e-12);

        if (goalDot < 0.05) {   // force is mostly sideways or backward
            stuckFrames++;
        } else {
            stuckFrames = std::max(0, stuckFrames - 2);  // decay when moving
        }

        if (stuckFrames >= cfg.escapeMinSteps) {
            // Compute tangential escape direction.
            double ex, ey;
            tangentialEscapeDir(px, py, gx, gy, req.obstacles,
                                cfg.influenceRadius, ex, ey);

            // Smooth the escape direction with EMA.
            const double alpha = 0.12;
            if (!escapeInitialized) {
                smoothedEscapeX   = ex;
                smoothedEscapeY   = ey;
                escapeInitialized = true;
            } else {
                smoothedEscapeX = smoothedEscapeX * (1.0 - alpha) + ex * alpha;
                smoothedEscapeY = smoothedEscapeY * (1.0 - alpha) + ey * alpha;
                double eLen = hypot2(smoothedEscapeX, smoothedEscapeY);
                if (eLen > 1e-12) {
                    smoothedEscapeX /= eLen;
                    smoothedEscapeY /= eLen;
                }
            }

            // Ramp escape strength.
            double rampT   = static_cast<double>(stuckFrames - cfg.escapeMinSteps)
                           / static_cast<double>(cfg.escapeRampSteps);
            double strength = smoothstep01(rampT);

            double bonus = strength * cfg.escapeGain * cfg.kAtt;
            ftx += smoothedEscapeX * bonus;
            fty += smoothedEscapeY * bonus;
        } else {
            escapeInitialized = false;
        }

        // ── Normalize total force ─────────────────────────────────────────────
        double fLen = hypot2(ftx, fty);
        double desiredDx, desiredDy;
        if (fLen < 1e-12) {
            // Zero force — fall back to direct goal direction.
            desiredDx = (gx - px) / distToGoal;
            desiredDy = (gy - py) / distToGoal;
        } else {
            desiredDx = ftx / fLen;
            desiredDy = fty / fLen;
        }

        // ── Heading smoothing (turn-rate limit) ───────────────────────────────
        double newHx, newHy;
        smoothHeading(hdx, hdy, desiredDx, desiredDy, cfg.maxTurnRad, newHx, newHy);
        hdx = newHx;
        hdy = newHy;

        // ── Move along smoothed heading ───────────────────────────────────────
        double actualStep = std::min(cfg.stepSize, distToGoal);
        double nx = clamp01(px + hdx * actualStep);
        double ny = clamp01(py + hdy * actualStep);

        // ── Record path point ─────────────────────────────────────────────────
        double mdx = nx - px, mdy = ny - py;
        if (mdx * mdx + mdy * mdy >= minRecordDist2) {
            path.push_back({nx, ny});
        }

        px = nx;
        py = ny;
    }

    // Ensure the goal is always the last point.
    if (!path.empty()) {
        auto& last = path.back();
        if (std::abs(last.x - gx) > 1e-6 || std::abs(last.y - gy) > 1e-6) {
            path.push_back({gx, gy});
        }
    }

    return path;
}

} // namespace daa
