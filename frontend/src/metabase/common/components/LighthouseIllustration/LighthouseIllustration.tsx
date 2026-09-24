import React, { useEffect, useRef } from "react";
import cx from "classnames";

import LighthouseSvg from "img/bridge.svg?component";
import { Box } from "metabase/ui";

import Styles from "./Lighthouse.module.css";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

export const LighthouseIllustration = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let animId: number;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let time = 0;
    let mouseX = -9999;
    let mouseY = -9999;
    let targetMouseX = -9999;
    let targetMouseY = -9999;

    const colors = {
      cyan: "#00DFD8",
      blue: "#0070F3",
      purple: "#7928CA",
      white: "#FFFFFF",
    };

    const particleCount = 38;
    const particles: Particle[] = [];

    const initParticles = (w: number, h: number) => {
      particles.length = 0;
      for (let i = 0; i < particleCount; i++) {
        const colorChoice = Math.random();
        const color =
          colorChoice < 0.5
            ? colors.cyan
            : colorChoice < 0.82
            ? colors.blue
            : colors.purple;

        particles.push({
          x: Math.random() * w,
          y: h * 0.35 + Math.random() * (h * 0.65),
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.22,
          size: 1.2 + Math.random() * 2.2,
          color,
          alpha: 0.35 + Math.random() * 0.45,
        });
      }
    };

    const handleResize = () => {
      if (!canvas.parentElement) {
        return;
      }
      const rect = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = Math.max(rect.height, 260);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
      if (particles.length === 0) {
        initParticles(width, height);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseX = e.clientX - rect.left;
      targetMouseY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      targetMouseX = -9999;
      targetMouseY = -9999;
    };

    handleResize();
    initParticles(width, height);

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    const render = () => {
      time += 0.016;

      // Smooth mouse interpolation for magnetic parallax
      if (targetMouseX !== -9999) {
        if (mouseX === -9999) {
          mouseX = targetMouseX;
          mouseY = targetMouseY;
        } else {
          mouseX += (targetMouseX - mouseX) * 0.08;
          mouseY += (targetMouseY - mouseY) * 0.08;
        }
      } else {
        mouseX = -9999;
        mouseY = -9999;
      }

      ctx.clearRect(0, 0, width, height);

      const isDarkMode =
        document.documentElement.getAttribute("data-mantine-color-scheme") !== "light" &&
        !document.body.classList.contains("theme-light");

      const horizonY = height * 0.68;
      const mouseParallaxX = mouseX !== -9999 ? (mouseX - width / 2) * 0.025 : 0;
      const mouseParallaxY = mouseY !== -9999 ? (mouseY - height / 2) * 0.025 : 0;

      // 1. Ambient Horizon Radial Glow Dome
      const glowGrad = ctx.createRadialGradient(
        width / 2 + mouseParallaxX,
        horizonY + mouseParallaxY,
        15,
        width / 2 + mouseParallaxX,
        horizonY + mouseParallaxY,
        width * 0.45
      );
      if (isDarkMode) {
        glowGrad.addColorStop(0, "rgba(0, 223, 216, 0.2)");
        glowGrad.addColorStop(0.35, "rgba(0, 112, 243, 0.12)");
        glowGrad.addColorStop(0.7, "rgba(121, 40, 202, 0.04)");
        glowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        glowGrad.addColorStop(0, "rgba(0, 112, 243, 0.12)");
        glowGrad.addColorStop(0.5, "rgba(0, 223, 216, 0.06)");
        glowGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      }
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. 3D Perspective Plane Wireframe (Vanishing at horizon center)
      const vanishX = width / 2 + mouseParallaxX * 1.4;
      const vanishY = horizonY - 35 + mouseParallaxY;
      const rayCount = 16;

      ctx.save();
      ctx.lineWidth = 1;
      for (let i = 0; i <= rayCount; i++) {
        const spread = (i / rayCount) * (width * 1.4) - width * 0.2;
        const rayGrad = ctx.createLinearGradient(vanishX, vanishY, spread, height);
        if (isDarkMode) {
          rayGrad.addColorStop(0, "rgba(0, 223, 216, 0)");
          rayGrad.addColorStop(0.35, "rgba(0, 112, 243, 0.2)");
          rayGrad.addColorStop(1, "rgba(0, 112, 243, 0.02)");
        } else {
          rayGrad.addColorStop(0, "rgba(0, 112, 243, 0)");
          rayGrad.addColorStop(0.5, "rgba(0, 112, 243, 0.14)");
          rayGrad.addColorStop(1, "rgba(0, 112, 243, 0.02)");
        }
        ctx.strokeStyle = rayGrad;
        ctx.beginPath();
        ctx.moveTo(vanishX, vanishY);
        ctx.lineTo(spread, height);
        ctx.stroke();
      }

      // Transverse Perspective Depth Rings
      const ringCount = 5;
      for (let j = 1; j <= ringCount; j++) {
        const progress = Math.pow(j / ringCount, 1.6);
        const ringY = vanishY + (height - vanishY) * progress;
        const ringAlpha = progress * (isDarkMode ? 0.35 : 0.2);

        ctx.strokeStyle = `rgba(0, 223, 216, ${ringAlpha})`;
        ctx.beginPath();
        ctx.moveTo(0, ringY + Math.sin(time + j) * 2);
        ctx.quadraticCurveTo(
          vanishX,
          ringY - 14 * progress + Math.sin(time + j * 0.7) * 3,
          width,
          ringY + Math.sin(time + j) * 2
        );
        ctx.stroke();
      }
      ctx.restore();

      // 3. Flowing Quantum Harmonic Waves
      const drawWave = (
        amplitude: number,
        frequency: number,
        speed: number,
        offsetY: number,
        strokeColor: string | CanvasGradient,
        lineWidth: number,
        fillGradient?: CanvasGradient,
        dash?: number[]
      ) => {
        ctx.save();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeColor;
        if (dash) {
          ctx.setLineDash(dash);
        }

        ctx.beginPath();
        ctx.moveTo(0, height);

        for (let x = 0; x <= width; x += 15) {
          const wavePhase = time * speed + x * frequency;
          const y =
            horizonY +
            offsetY +
            Math.sin(wavePhase) * amplitude +
            Math.cos(wavePhase * 0.5 + time * 0.4) * (amplitude * 0.4);

          if (x === 0) {
            ctx.lineTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();

        if (fillGradient) {
          ctx.fillStyle = fillGradient;
          ctx.fill();
        }

        // Stroke along wave contour
        ctx.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const wavePhase = time * speed + x * frequency;
          const y =
            horizonY +
            offsetY +
            Math.sin(wavePhase) * amplitude +
            Math.cos(wavePhase * 0.5 + time * 0.4) * (amplitude * 0.4);

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      };

      // Wave 1: Ambient volumetric undercurrent
      const waveFillGrad = ctx.createLinearGradient(0, horizonY - 40, 0, height);
      if (isDarkMode) {
        waveFillGrad.addColorStop(0, "rgba(0, 112, 243, 0.08)");
        waveFillGrad.addColorStop(0.6, "rgba(0, 223, 216, 0.03)");
        waveFillGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        waveFillGrad.addColorStop(0, "rgba(0, 112, 243, 0.06)");
        waveFillGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      }

      // Wave 1: Slow luminous swell
      const wave1Grad = ctx.createLinearGradient(0, 0, width, 0);
      wave1Grad.addColorStop(0, "rgba(0, 112, 243, 0.1)");
      wave1Grad.addColorStop(0.3, "rgba(0, 223, 216, 0.75)");
      wave1Grad.addColorStop(0.7, "rgba(0, 112, 243, 0.85)");
      wave1Grad.addColorStop(1, "rgba(121, 40, 202, 0.4)");
      drawWave(26, 0.0022, 0.6, 18, wave1Grad, 2, waveFillGrad);

      // Wave 2: Harmonic secondary dashed wave
      const wave2Grad = ctx.createLinearGradient(0, 0, width, 0);
      wave2Grad.addColorStop(0, "rgba(121, 40, 202, 0.3)");
      wave2Grad.addColorStop(0.5, "rgba(0, 223, 216, 0.65)");
      wave2Grad.addColorStop(1, "rgba(0, 112, 243, 0.3)");
      drawWave(34, 0.0016, 0.85, 42, wave2Grad, 1.5, undefined, [8, 6]);

      // Wave 3: High-frequency energetic ripple
      const wave3Grad = ctx.createLinearGradient(0, 0, width, 0);
      wave3Grad.addColorStop(0, "rgba(0, 223, 216, 0.2)");
      wave3Grad.addColorStop(0.5, "#00DFD8");
      wave3Grad.addColorStop(1, "rgba(0, 112, 243, 0.3)");
      drawWave(18, 0.0035, 1.1, -12, wave3Grad, 1.8);

      // 4. Horizon Laser Horizon Line with breathing center
      const laserGrad = ctx.createLinearGradient(0, 0, width, 0);
      laserGrad.addColorStop(0, "rgba(0, 112, 243, 0)");
      laserGrad.addColorStop(0.2, "rgba(0, 223, 216, 0.4)");
      laserGrad.addColorStop(0.5, "rgba(0, 223, 216, 0.95)");
      laserGrad.addColorStop(0.8, "rgba(121, 40, 202, 0.4)");
      laserGrad.addColorStop(1, "rgba(0, 112, 243, 0)");

      ctx.save();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = laserGrad;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(width, horizonY);
      ctx.stroke();
      ctx.restore();

      // 5. Constellation Particles & Magnetic Interactivity
      ctx.save();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Motion update
        p.x += p.vx;
        p.y += p.vy;

        // Boundary wrap
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < height * 0.3) p.y = height;
        if (p.y > height) p.y = height * 0.3;

        // Interactive mouse magnetic nudge
        if (mouseX !== -9999) {
          const dx = mouseX - p.x;
          const dy = mouseY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            const force = (1 - dist / 130) * 0.5;
            p.x -= (dx / dist) * force * 2.5;
            p.y -= (dy / dist) * force * 2.5;
          }
        }

        // Draw particle
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * (isDarkMode ? 1 : 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Particle subtle pulse ring
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.6;
        ctx.globalAlpha = p.alpha * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
        ctx.stroke();

        // Connect nearby particles (constellation links)
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const cdx = p.x - p2.x;
          const cdy = p.y - p2.y;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

          if (cdist < 85) {
            const lineAlpha = (1 - cdist / 85) * 0.25 * (isDarkMode ? 1 : 0.6);
            ctx.strokeStyle = isDarkMode
              ? `rgba(0, 223, 216, ${lineAlpha})`
              : `rgba(0, 112, 243, ${lineAlpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // 6. HUD Telemetry Coordinates Marker
      ctx.save();
      ctx.font = "9px Geist, Inter, -apple-system, monospace";
      ctx.fillStyle = isDarkMode ? "rgba(0, 223, 216, 0.35)" : "rgba(0, 112, 243, 0.4)";
      ctx.fillText(`SYS.MATRIX // 60FPS // T+${Math.floor(time * 10)}`, 32, height - 16);

      // Central Nexus Beacon Crosshair
      const centerPulse = Math.sin(time * 2) * 2;
      ctx.strokeStyle = "rgba(0, 223, 216, 0.6)";
      ctx.lineWidth = 1;
      const nexusX = width / 2 + mouseParallaxX;
      const nexusY = horizonY;

      ctx.beginPath();
      ctx.moveTo(nexusX - 8, nexusY);
      ctx.lineTo(nexusX + 8, nexusY);
      ctx.moveTo(nexusX, nexusY - 8);
      ctx.lineTo(nexusX, nexusY + 8);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(nexusX, nexusY, 12 + centerPulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <Box className={Styles.LighthouseContainer} w="100%" h="100%">
      <canvas
        ref={canvasRef}
        className={Styles.LighthouseCanvas}
      />
    </Box>
  );
};

export const LighthouseIllustrationThumbnail = () => {
  return (
    <Box className={Styles.LighthouseContainer} w="90px" h="90px">
      <LighthouseSvg
        width="100%"
        height="100%"
        className={cx(Styles.LighthouseColors, Styles.LighthouseThumbnail)}
      />
    </Box>
  );
};
