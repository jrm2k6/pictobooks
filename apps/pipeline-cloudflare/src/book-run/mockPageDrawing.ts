export const mockPageDrawing = {
  width: 2480,
  height: 3508,
  frame: { x: 90, y: 90, width: 2300, height: 3328, radius: 80, stroke: 64 },
  paths: [
    {
      d: "M930 1350 Q1240 1600 1550 1350",
      stroke: 54,
      round: true,
    },
    {
      d: "M560 2900 Q1240 2050 1920 2900",
      stroke: 70,
      round: false,
    },
  ],
  circles: [
    { x: 1240, y: 1150, radius: 620, stroke: 54 },
    { x: 1010, y: 1050, radius: 55, stroke: 0 },
    { x: 1470, y: 1050, radius: 55, stroke: 0 },
  ],
};

export const mockCandidateSvg = (
  candidateId: string,
  semanticAttempt: number
): string => {
  const { width, height, frame, paths, circles } = mockPageDrawing;
  const [face, leftEye, rightEye] = circles;
  const circle = ({ x, y, radius, stroke }: typeof face) =>
    `<circle cx="${x}" cy="${y}" r="${radius}" fill="${stroke ? `white" stroke="black" stroke-width="${stroke}` : "black"}"/>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white"/>
  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="black" stroke-width="${frame.stroke}"/>
  ${circle(face)}
  ${circle(leftEye)}${circle(rightEye)}
  ${paths.map(path => `<path d="${path.d}" fill="none" stroke="black" stroke-width="${path.stroke}"${path.round ? ' stroke-linecap="round"' : ""}/>`).join("\n  ")}
  <text x="120" y="3380" font-size="1" fill="white">${candidateId}-${semanticAttempt}</text>
</svg>`.trim();
};
