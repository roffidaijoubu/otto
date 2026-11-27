export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Otto — Sign In</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; color: #303030;
      background-color: #dbdbdb;
      position: relative; isolation: isolate; overflow: hidden;
      font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
      display: grid; place-items: center; padding: 16px;
    }
    body::before, body::after {
      content: ""; position: fixed; inset: -28%; z-index: -1;
      pointer-events: none; will-change: transform;
    }
    body::before {
      background-image:
        radial-gradient(circle at 10% 8%, #cfd5df 0%, rgba(207,213,223,0) 48%),
        radial-gradient(circle at 94% 10%, #dc6b46 0%, rgba(220,107,70,0) 52%),
        radial-gradient(circle at 90% 92%, #df7a59 0%, rgba(223,122,89,0) 50%),
        radial-gradient(circle at 8% 92%, #e59d81 0%, rgba(229,157,129,0) 52%),
        linear-gradient(135deg, #d7d5d6 0%, #dcd4d2 48%, #e6b29a 100%);
      animation: otto-drift-a 24s ease-in-out infinite;
    }
    body::after {
      background-image:
        radial-gradient(circle at 22% 72%, rgba(220,107,70,0.34) 0%, rgba(220,107,70,0) 46%),
        radial-gradient(circle at 76% 24%, rgba(188,204,226,0.42) 0%, rgba(188,204,226,0) 48%),
        radial-gradient(circle at 52% 52%, rgba(249,245,162,0.14) 0%, rgba(249,245,162,0) 44%);
      animation: otto-drift-b 32s ease-in-out infinite;
    }
    @keyframes otto-drift-a {
      0% { transform: translate3d(0%, 0%, 0) scale(1) rotate(0deg); }
      33% { transform: translate3d(4%, -3%, 0) scale(1.06) rotate(3deg); }
      66% { transform: translate3d(-3%, 4%, 0) scale(1.03) rotate(-2deg); }
      100% { transform: translate3d(0%, 0%, 0) scale(1) rotate(0deg); }
    }
    @keyframes otto-drift-b {
      0% { transform: translate3d(0%, 0%, 0) scale(1.02) rotate(0deg); }
      35% { transform: translate3d(-5%, 4%, 0) scale(1.08) rotate(-4deg); }
      70% { transform: translate3d(5%, 2%, 0) scale(0.98) rotate(3deg); }
      100% { transform: translate3d(0%, 0%, 0) scale(1.02) rotate(0deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      body::before, body::after { animation: none; }
    }
    .card {
      width: min(92vw, 390px); background: #ffffff;
      border-radius: 20px; box-shadow: 0 3px 6px rgba(0,0,0,0.16);
      overflow: hidden;
    }
    .head {
      text-align: center; padding: 9px 16px;
      border-bottom: 1px solid #ededed;
      font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #303030;
    }
    .body { padding: 26px 26px 28px; text-align: center; }
    .mascot { margin: 0 auto 14px; display: block; }
    h1 {
      margin: 0 0 8px 0; font-weight: 400; font-size: 24px;
      letter-spacing: -0.02em; color: #303030; line-height: 1.25;
    }
    .mark { background: #f9f5a2; padding: 0 2px; }
    p {
      margin: 0 0 18px 0; font-family: "IBM Plex Mono", monospace;
      font-size: 11.5px; color: #808080; line-height: 1.5;
    }
    input {
      width: 100%; padding: 11px 16px; border: none; border-radius: 25px;
      background: #ededed; color: #303030;
      font-family: "IBM Plex Mono", monospace; font-size: 13px;
      margin-bottom: 12px; outline: none; text-align: center;
    }
    input:focus { box-shadow: 0 0 0 2px #303030; }
    button {
      width: 100%; padding: 11px 16px; border: none; border-radius: 9999px;
      background: #303030; color: #ffffff;
      font-family: "IBM Plex Mono", monospace; font-size: 12.5px; font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #141414; }
    .err { color: #991b1b; font-family: "IBM Plex Mono", monospace; font-size: 11.5px; margin-top: 10px; }
  </style>
</head>
<body>
  <form class="card" id="f">
    <div class="head">(Y)our studio.</div>
    <div class="body">
      <svg class="mascot" id="otto-login" width="60" height="60" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Otto mascot">
        <defs>
          <clipPath id="lg-clip"><circle cx="24" cy="23.5" r="20.6" /></clipPath>
          <radialGradient id="lg-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.28" />
            <stop offset="65%" stop-color="#000" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#000" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="lg-shade" cx="66%" cy="72%" r="74%" fx="33%" fy="27%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.44" />
            <stop offset="42%" stop-color="#fff" stop-opacity="0" />
            <stop offset="76%" stop-color="#000" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#000" stop-opacity="0.48" />
          </radialGradient>
          <radialGradient id="lg-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.56" />
            <stop offset="55%" stop-color="#fff" stop-opacity="0.14" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="lg-rim" cx="76%" cy="82%" r="48%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="24" cy="44.8" rx="14.5" ry="2.6" fill="url(#lg-shadow)" />
        <circle cx="24" cy="23.5" r="20.6" fill="#303030" />
        <circle cx="24" cy="23.5" r="20.6" fill="url(#lg-shade)" />
        <circle cx="24" cy="23.5" r="20.6" fill="url(#lg-rim)" />
        <ellipse id="lg-glint" cx="16.4" cy="14.2" rx="6.2" ry="3.9" transform="rotate(-28 16.4 14.2)" fill="url(#lg-spec)" />
        <g clip-path="url(#lg-clip)">
          <g id="lg-face">
            <ellipse cx="18.2" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />
            <ellipse cx="29.8" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />
            <ellipse cx="18.2" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />
            <ellipse cx="29.8" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />
            <circle id="lg-pl" cx="18.2" cy="23.2" r="2.35" fill="#1F1F1F" />
            <circle id="lg-pr" cx="29.8" cy="23.2" r="2.35" fill="#1F1F1F" />
            <circle id="lg-cl" cx="17.4" cy="22.1" r="0.82" fill="#FFFFFF" />
            <circle id="lg-cr" cx="29.0" cy="22.1" r="0.82" fill="#FFFFFF" />
          </g>
        </g>
      </svg>
      <h1>Otto is <span class="mark">(y)</span>our stream manager.</h1>
      <p>Enter your passcode to unlock this private Sprite studio.</p>
      <input type="password" id="pw" placeholder="Input your passcode." autocomplete="current-password" autofocus required />
      <button type="submit">Unlock Studio</button>
      <div class="err" id="err"></div>
    </div>
  </form>
  <script>
    (function () {
      const svg = document.getElementById("otto-login");
      const face = document.getElementById("lg-face");
      const shade = document.getElementById("lg-shade");
      const glint = document.getElementById("lg-glint");
      const pl = document.getElementById("lg-pl");
      const pr = document.getElementById("lg-pr");
      const cl = document.getElementById("lg-cl");
      const cr = document.getElementById("lg-cr");
      let lx = 0.12, ly = 0.06, tx = 0.12, ty = 0.06, raf = null;
      function draw() {
        raf = null;
        const dx = tx - lx, dy = ty - ly;
        if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) { lx = tx; ly = ty; }
        else { lx += dx * 0.16; ly += dy * 0.16; raf = requestAnimationFrame(draw); }
        const mx = lx * 6.4, my = ly * 5.6;
        const sx = 1 - Math.abs(lx) * 0.16, sy = 1 - Math.abs(ly) * 0.13, rot = lx * ly * -6;
        face.setAttribute("transform", "translate(" + mx.toFixed(2) + "," + my.toFixed(2) + ") translate(24,23.2) rotate(" + rot.toFixed(2) + ") scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ") translate(-24,-23.2)");
        shade.setAttribute("fx", (33 - lx * 6.5).toFixed(1) + "%");
        shade.setAttribute("fy", (27 - ly * 6.5).toFixed(1) + "%");
        const gx = (16.4 - lx * 1.6).toFixed(1), gy = (14.2 - ly * 1.4).toFixed(1);
        glint.setAttribute("cx", gx); glint.setAttribute("cy", gy);
        glint.setAttribute("transform", "rotate(-28 " + gx + " " + gy + ")");
        const px = lx * 1.45, py = ly * 1.25;
        pl.setAttribute("cx", (18.2 + px).toFixed(2)); pl.setAttribute("cy", (23.2 + py).toFixed(2));
        pr.setAttribute("cx", (29.8 + px).toFixed(2)); pr.setAttribute("cy", (23.2 + py).toFixed(2));
        cl.setAttribute("cx", (17.4 + px).toFixed(2)); cl.setAttribute("cy", (22.1 + py).toFixed(2));
        cr.setAttribute("cx", (29.0 + px).toFixed(2)); cr.setAttribute("cy", (22.1 + py).toFixed(2));
      }
      window.addEventListener("pointermove", (e) => {
        const r = svg.getBoundingClientRect();
        const vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(vx, vy);
        const mag = Math.tanh(d / 200);
        tx = d > 0.5 ? (vx / d) * mag : 0;
        ty = d > 0.5 ? (vy / d) * mag : 0;
        if (!raf) raf = requestAnimationFrame(draw);
      }, { passive: true });
    })();
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("err");
      err.textContent = "";
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: document.getElementById("pw").value }),
      });
      if (res.ok) location.reload();
      else {
        const data = await res.json().catch(() => ({}));
        err.textContent = data.error || "Invalid passcode.";
      }
    });
  </script>
</body>
</html>`;
