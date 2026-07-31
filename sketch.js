function setup() {
  noCanvas();
  drawChart();
  window.addEventListener("resize", drawChart);
}

// 🎨 Même rouge officiel ZIVI (accent6) que le bar chart original.
const BASE_RED = "#FF0000";
const LIGHT_RED = "#FFD1D1";

// --- Formatage suisse : 1'234 ---
function formatSwiss(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function drawChart() {

  d3.select("#chart").selectAll("*").remove();

  const containerWidth = document.getElementById("chart").clientWidth;
  const isMobile = containerWidth < 600;

  d3.csv("EAZ_Kurse_pro_Kursart_2025.csv").then(raw => {

    const data = raw.map(d => {
      const parts = d.Label.split(" / ");
      return {
        label: d.Label,
        parts,
        shortLabel: parts[0],
        value: +d.Value
      };
    });

    const panelHeight = isMobile ? 500 : 580;

    const svg = d3.select("#chart")
      .append("svg")
      .attr("width", containerWidth)
      .attr("height", panelHeight);

    // --- Calcul du treemap (aire ∝ nombre de cours) ---
    const root = d3.hierarchy({ children: data })
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value);

    // ratio(1) plutôt que le ratio doré par défaut : des cases plus proches
    // du carré, avec largeur et hauteur toutes deux exploitables pour le
    // texte sur plusieurs lignes (au lieu de rectangles très étirés).
    d3.treemap()
      .tile(d3.treemapSquarify.ratio(1))
      .size([containerWidth, panelHeight])
      .paddingInner(3)
      .round(true)(root);

    const minVal = d3.min(data, d => d.value);
    const maxVal = d3.max(data, d => d.value);

    // Échelle de couleur en racine carrée, comme dans le bar chart original :
    // l'écart (4 à 259) resterait sinon écrasé par la seule plus grande valeur.
    const colorScale = d3.scaleSqrt().domain([minVal, maxVal]).range([0, 1]);

    // --- Élément de mesure invisible, réutilisé pour ajuster le texte ---
    const measureEl = svg.append("text")
      .style("visibility", "hidden")
      .style("font-family", "Arial");

    function measure(str, fontSize) {
      measureEl.style("font-size", `${fontSize}px`).text(str);
      return measureEl.node().getComputedTextLength();
    }

    // Répartit un texte sur autant de lignes que nécessaire pour tenir
    // dans maxWidth, à une taille de police donnée.
    function wrapWords(text, fontSize, maxWidth) {
      const words = text.split(" ");
      const lines = [];
      let current = [];
      words.forEach(word => {
        const candidate = [...current, word].join(" ");
        if (current.length === 0 || measure(candidate, fontSize) <= maxWidth) {
          current.push(word);
        } else {
          lines.push(current.join(" "));
          current = [word];
        }
      });
      if (current.length) lines.push(current.join(" "));
      return lines;
    }

    // Cherche la plus grande taille de police (entre minFont et maxFont)
    // qui permet aux 3 langues, chacune réparties sur plusieurs lignes si
    // besoin, de tenir ensemble dans la case. C'est ce qui garantit que
    // même les cours à faible valeur (donc à petite case) affichent quand
    // même leur nom, dans les 3 langues.
    function fitMultilineText(texts, boxW, boxH, maxFont, minFont) {
      for (let fs = maxFont; fs >= minFont; fs -= 0.5) {
        const lineHeight = fs * 1.15;
        const blockGap = fs * 0.35;
        const blocks = texts.map(t => wrapWords(t, fs, boxW));
        const totalH = blocks.reduce(
          (sum, lines, i) => sum + lines.length * lineHeight + (i > 0 ? blockGap : 0),
          0
        );
        if (totalH <= boxH) {
          return { fontSize: fs, lineHeight, blockGap, blocks };
        }
      }
      // Dernier recours à la taille minimale : une ligne tronquée par langue.
      const fs = minFont;
      const lineHeight = fs * 1.15;
      const blockGap = fs * 0.3;
      const blocks = texts.map(t => {
        let line = t;
        while (line.length > 1 && measure(line, fs) > boxW) {
          line = line.slice(0, -1);
        }
        if (line.length < t.length) line = line.slice(0, -1) + "…";
        return [line];
      });
      return { fontSize: fs, lineHeight, blockGap, blocks };
    }

    // --- Bulle flottante au survol : nom trilingue complet + valeur ---
    const tooltip = svg.append("g").style("opacity", 0).style("pointer-events", "none");
    const tooltipRect = tooltip.append("rect")
      .attr("fill", "white")
      .attr("stroke", "#555")
      .attr("stroke-width", 1.2)
      .attr("rx", 5);
    const tooltipText = tooltip.append("text")
      .style("font-family", "Arial")
      .style("fill", "#111");

    const padX = 10, padY = 8;

    function showTooltip(event, d) {
      tooltip.raise();
      const [mx, my] = d3.pointer(event, svg.node());

      tooltipText.selectAll("tspan").remove();
      tooltipText.attr("x", padX).attr("y", 0);

      d.data.parts.forEach((p, i) => {
        tooltipText.append("tspan")
          .attr("x", padX)
          .attr("dy", i === 0 ? 0 : "1.25em")
          .style("font-weight", "normal")
          .style("font-size", "12.5px")
          .text(p);
      });

      tooltipText.append("tspan")
        .attr("x", padX).attr("dy", "1.5em")
        .style("font-weight", "bold")
        .style("font-size", "13.5px")
        .style("fill", BASE_RED)
        .text(formatSwiss(d.data.value));

      const bbox = tooltipText.node().getBBox();
      const boxW = bbox.width + padX * 2;
      const boxH = bbox.height + padY * 2;

      let tx = mx + 14;
      let ty = my - boxH - 12;
      if (tx + boxW > containerWidth) tx = mx - boxW - 14;
      if (ty < 0) ty = my + 14;

      tooltip.attr("transform", `translate(${tx}, ${ty})`);
      tooltipRect.attr("width", boxW).attr("height", boxH);
      tooltipText.attr("y", padY - bbox.y);
      tooltip.style("opacity", 1);
    }

    function hideTooltip() {
      tooltip.style("opacity", 0);
    }

    // --- Cases du treemap, une par genre de cours ---
    const cell = svg.selectAll("g.cell")
      .data(root.leaves())
      .enter()
      .append("g")
      .attr("class", "cell")
      .attr("transform", d => `translate(${d.x0}, ${d.y0})`)
      .style("cursor", "pointer");

    cell.append("rect")
      .attr("width", d => d.x1 - d.x0)
      .attr("height", d => d.y1 - d.y0)
      .attr("fill", d => d3.interpolate(LIGHT_RED, BASE_RED)(colorScale(d.data.value)))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .style("opacity", 0)
      .transition()
      .delay((d, i) => i * 70)
      .duration(500)
      .ease(d3.easeCubicOut)
      .style("opacity", 1);

    const padding = 4;
    const topPad = 6; // respire un peu par rapport au haut de la case

    cell.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 18 || h < 14) return; // case vraiment trop petite pour du texte

      const boxW = w - padding * 2;
      // On ne réserve de la place pour la valeur que si la case est
      // largement assez haute : les 3 langues du nom passent en priorité.
      const reserveValue = h > 70;
      const boxH = h - padding * 2 - topPad - (reserveValue ? 14 : 0);

      const fit = fitMultilineText(d.data.parts, boxW, boxH, 11.5, 7.5);

      const label = d3.select(this).append("text")
        .attr("class", "tile-label")
        .style("font-family", "Arial")
        .style("font-weight", "normal")
        .style("fill", "#111")
        .style("opacity", 0);

      let first = true;
      let totalLines = 0;

      fit.blocks.forEach((lines, bi) => {
        lines.forEach((line, li) => {
          let dy;
          if (first) {
            dy = fit.fontSize + topPad;
            first = false;
          } else if (li === 0) {
            dy = fit.lineHeight + fit.blockGap;
          } else {
            dy = fit.lineHeight;
          }
          label.append("tspan")
            .attr("x", padding)
            .attr("dy", dy)
            .style("font-size", `${fit.fontSize}px`)
            .text(line);
          totalLines++;
        });
      });

      label.transition().delay(400).duration(300).style("opacity", 1);

      if (reserveValue) {
        const labelHeight = totalLines * fit.lineHeight + (fit.blocks.length - 1) * fit.blockGap;
        const valueY = padding + topPad + labelHeight + 12;

        d3.select(this).append("text")
          .attr("class", "tile-value")
          .attr("x", padding)
          .attr("y", valueY)
          .style("font-family", "Arial")
          .style("font-size", isMobile ? "10.5px" : "11.5px")
          .style("font-weight", "bold")
          .style("fill", "#333")
          .style("opacity", 0)
          .text("0")
          .transition()
          .delay(450)
          .duration(400)
          .style("opacity", 1)
          .textTween(function () {
            const iVal = d3.interpolateNumber(0, d.data.value);
            return t => formatSwiss(iVal(t));
          });
      }
    });

    // --- Survol : contour marqué + bulle avec le nom trilingue complet ---
    cell
      .on("mouseover", function (event, d) {
        d3.select(this).select("rect").attr("stroke", "#333").attr("stroke-width", 2.5);
        showTooltip(event, d);
      })
      .on("mousemove", (event, d) => showTooltip(event, d))
      .on("mouseout", function () {
        d3.select(this).select("rect").attr("stroke", "#fff").attr("stroke-width", 1.5);
        hideTooltip();
      });
  });
}
