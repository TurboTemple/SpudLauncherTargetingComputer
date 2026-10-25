"""Reference solver used to generate acceptance-test numbers for the spec.

Point mass, gravity + quadratic drag relative to wind, RK4 fixed step,
flat ground at z = 0, launch from muzzle height h0. Impact found by
linear interpolation across the step where z crosses 0 on the way down.
"""
import math

G = 9.81


def k_factor(rho, cd, d, m):
    area = math.pi * d * d / 4.0
    return rho * cd * area / (2.0 * m)


def accel(v, k, wind):
    rx, ry, rz = v[0] - wind[0], v[1] - wind[1], v[2] - wind[2]
    s = math.sqrt(rx * rx + ry * ry + rz * rz)
    return (-k * s * rx, -k * s * ry, -G - k * s * rz)


def simulate(v0, elev_deg, az_deg=0.0, k=0.0, wind=(0.0, 0.0, 0.0), h0=0.0, dt=1e-4, tmax=60.0):
    el, az = math.radians(elev_deg), math.radians(az_deg)
    # ENU: x east, y north, z up; azimuth clockwise from north
    v = [v0 * math.cos(el) * math.sin(az), v0 * math.cos(el) * math.cos(az), v0 * math.sin(el)]
    p = [0.0, 0.0, h0]
    t = 0.0
    apex = h0
    while t < tmax:
        def f(pp, vv):
            return vv, accel(vv, k, wind)
        k1p, k1v = f(p, v)
        p2 = [p[i] + 0.5 * dt * k1p[i] for i in range(3)]
        v2 = [v[i] + 0.5 * dt * k1v[i] for i in range(3)]
        k2p, k2v = f(p2, v2)
        p3 = [p[i] + 0.5 * dt * k2p[i] for i in range(3)]
        v3 = [v[i] + 0.5 * dt * k2v[i] for i in range(3)]
        k3p, k3v = f(p3, v3)
        p4 = [p[i] + dt * k3p[i] for i in range(3)]
        v4 = [v[i] + dt * k3v[i] for i in range(3)]
        k4p, k4v = f(p4, v4)
        pn = [p[i] + dt / 6 * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]) for i in range(3)]
        vn = [v[i] + dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]) for i in range(3)]
        apex = max(apex, pn[2])
        if pn[2] <= 0.0 and vn[2] < 0.0:
            frac = p[2] / (p[2] - pn[2])
            hit = [p[i] + frac * (pn[i] - p[i]) for i in range(3)]
            vhit = [v[i] + frac * (vn[i] - v[i]) for i in range(3)]
            return {
                "x": hit[0], "y": hit[1],
                "range": math.hypot(hit[0], hit[1]),
                "tof": t + frac * dt,
                "apex": apex,
                "impact_speed": math.sqrt(sum(c * c for c in vhit)),
            }
        p, v, t = pn, vn, t + dt
    raise RuntimeError("no impact")


def max_range_angle(v0, k, h0):
    lo, hi = 1.0, 80.0
    phi = (math.sqrt(5) - 1) / 2
    a, b = hi - phi * (hi - lo), lo + phi * (hi - lo)
    fa = simulate(v0, a, k=k, h0=h0, dt=1e-3)["range"]
    fb = simulate(v0, b, k=k, h0=h0, dt=1e-3)["range"]
    for _ in range(40):
        if fa < fb:
            lo, a, fa = a, b, fb
            b = lo + phi * (hi - lo)
            fb = simulate(v0, b, k=k, h0=h0, dt=1e-3)["range"]
        else:
            hi, b, fb = b, a, fa
            a = hi - phi * (hi - lo)
            fa = simulate(v0, a, k=k, h0=h0, dt=1e-3)["range"]
    ang = (lo + hi) / 2
    return ang, simulate(v0, ang, k=k, h0=h0)["range"]


def solve_elev(v0, k, h0, target, lo, hi):
    rlo = simulate(v0, lo, k=k, h0=h0, dt=1e-3)["range"] - target
    for _ in range(60):
        mid = (lo + hi) / 2
        rm = simulate(v0, mid, k=k, h0=h0, dt=1e-3)["range"] - target
        if (rm > 0) == (rlo > 0):
            lo, rlo = mid, rm
        else:
            hi = mid
    return (lo + hi) / 2


def orient_to_barrel(alpha, beta, gamma):
    """W3C Z-X'-Y'' rotation; barrel along device +Y. Returns (elev, azimuth)."""
    a, b, g = map(math.radians, (alpha, beta, gamma))
    cX, cZ = math.cos(b), math.cos(a)
    sX, sZ = math.sin(b), math.sin(a)
    # second column of R = Rz(a) Rx(b) Ry(g)
    e, n, u = -cX * sZ, cZ * cX, sX
    elev = math.degrees(math.asin(u))
    az = (math.degrees(math.atan2(e, n)) + 360) % 360
    return elev, az


if __name__ == "__main__":
    k = k_factor(1.225, 0.6, 0.05, 0.15)
    print(f"default k = {k:.6f} 1/m, terminal speed = {math.sqrt(G / k):.2f} m/s")
    for tc in (0, 15, 25):
        print(f"rho at {tc} C = {101325 / (287.05 * (273.15 + tc)):.4f}")

    cases = [
        ("T1 vacuum 40 m/s 45deg h0=0", dict(v0=40, elev_deg=45, k=0.0, h0=0.0)),
        ("T2 vacuum 40 m/s 30deg h0=1", dict(v0=40, elev_deg=30, k=0.0, h0=1.0)),
        ("T3 drag 40 m/s 45deg", dict(v0=40, elev_deg=45, k=k, h0=1.0)),
        ("T4 drag 40 m/s 30deg", dict(v0=40, elev_deg=30, k=k, h0=1.0)),
        ("T5 drag 60 m/s 45deg", dict(v0=60, elev_deg=45, k=k, h0=1.0)),
        ("T6 T3 + wind from north 5", dict(v0=40, elev_deg=45, k=k, h0=1.0, wind=(0.0, -5.0, 0.0))),
        ("T7 T3 + wind from west 5", dict(v0=40, elev_deg=45, k=k, h0=1.0, wind=(5.0, 0.0, 0.0))),
        ("T8 T3 at azimuth 90", dict(v0=40, elev_deg=45, az_deg=90, k=k, h0=1.0)),
    ]
    for name, kw in cases:
        r = simulate(**kw)
        print(f"{name}: x={r['x']:.2f} y={r['y']:.2f} range={r['range']:.2f} "
              f"tof={r['tof']:.3f} apex={r['apex']:.2f} vimp={r['impact_speed']:.2f}")

    a = simulate(40, 45, k=k, h0=1.0, dt=1e-2)["range"]
    b = simulate(40, 45, k=k, h0=1.0, dt=5e-4)["range"]
    print(f"dt 10 ms vs 0.5 ms range diff = {abs(a - b) * 1000:.3f} mm")

    for v in (40, 60):
        ang, rmax = max_range_angle(v, k, 1.0)
        print(f"max reach at {v} m/s: {ang:.2f} deg, {rmax:.2f} m")

    ang, _ = max_range_angle(40, k, 1.0)
    low = solve_elev(40, k, 1.0, 60.0, 1.0, ang)
    high = solve_elev(40, k, 1.0, 60.0, ang, 85.0)
    print(f"target 60 m at 40 m/s: low {low:.2f} deg "
          f"({simulate(40, low, k=k, h0=1.0)['tof']:.2f} s), high {high:.2f} deg "
          f"({simulate(40, high, k=k, h0=1.0)['tof']:.2f} s)")

    for o in [(0, 0, 0), (0, 30, 0), (90, 30, 0), (270, 10, 0), (0, 30, 20), (45, 60, -15)]:
        print("orientation", o, "->", tuple(round(x, 3) for x in orient_to_barrel(*o)))

    for p in (0.5, 0.9, 0.95):
        print(f"ellipse scale for {p}: {math.sqrt(-2 * math.log(1 - p)):.4f}")
