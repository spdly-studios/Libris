window.Charts = (function() {
    // Internal state
    const instances = {};
    const resizeObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(entries => {
        for (let entry of entries) {
            const canvasId = entry.target.id;
            if (instances[canvasId]) {
                // Throttle redraw slightly
                if (instances[canvasId].resizeTimeout) clearTimeout(instances[canvasId].resizeTimeout);
                instances[canvasId].resizeTimeout = setTimeout(() => {
                    Charts.refresh(canvasId);
                }, 50);
            }
        }
    }) : null;

    // Color palette (Minimal, Calm, Professional)
    const CHART_COLORS = [
        '#1E293B', '#2563EB', '#059669', '#D97706', '#64748B', 
        '#0284C7', '#475569', '#3B82F6', '#0D9488', '#52525B'
    ];

    // Helpers
    function getTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return {
            text: isDark ? '#FAFAFA' : '#18181B',
            textMuted: isDark ? '#A1A1AA' : '#71717A',
            grid: isDark ? '#27272A' : '#E4E4E7',
            bg: isDark ? '#121215' : '#FFFFFF',
            tooltipBg: isDark ? '#18181B' : '#FFFFFF',
            tooltipText: isDark ? '#FAFAFA' : '#18181B',
            tooltipBorder: isDark ? '#27272A' : '#E4E4E7'
        };
    }

    function setupCanvas(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // Only set width/height if it changed to prevent unnecessary clears
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        }
        
        const ctx = canvas.getContext('2d');
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        return { canvas, ctx, width: rect.width, height: rect.height, dpr };
    }

    function registerInstance(canvasId, type, config) {
        const canvas = document.getElementById(canvasId);
        if (canvas && !instances[canvasId] && resizeObserver) {
            resizeObserver.observe(canvas);
        }
        
        instances[canvasId] = {
            type,
            config,
            canvas,
            progress: 0,
            hover: null,
            mousePos: {x: -1, y: -1}
        };

        // Attach mouse events once
        if (canvas && !canvas.hasAttribute('data-chart-events')) {
            canvas.setAttribute('data-chart-events', 'true');
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                if (instances[canvasId]) {
                    instances[canvasId].mousePos = {
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top
                    };
                    requestAnimationFrame(() => renderChart(canvasId, true)); // skip animation progress reset
                }
            });
            canvas.addEventListener('mouseleave', () => {
                if (instances[canvasId]) {
                    instances[canvasId].mousePos = {x: -1, y: -1};
                    requestAnimationFrame(() => renderChart(canvasId, true));
                }
            });
        }
    }

    function animate(canvasId) {
        const instance = instances[canvasId];
        if (!instance) return;
        
        const duration = 800; // ms
        const start = performance.now();
        
        function step(timestamp) {
            const progress = Math.min((timestamp - start) / duration, 1);
            // Ease out cubic
            instance.progress = 1 - Math.pow(1 - progress, 3);
            
            renderChart(canvasId, false); // false means don't skip animation
            
            if (progress < 1) {
                requestAnimationFrame(step);
            }
        }
        requestAnimationFrame(step);
    }

    // Chart Renderers
    function renderChart(canvasId, isUpdate = false) {
        const instance = instances[canvasId];
        if (!instance) return;
        
        const setup = setupCanvas(canvasId);
        if (!setup) return;
        const { ctx, width, height } = setup;
        if (width <= 0 || height <= 0) return;
        
        ctx.clearRect(0, 0, width, height);
        const theme = getTheme();
        
        // Draw title only if explicitly requested, otherwise use card header
        let chartTop = 15;
        if (instance.config.showTitle && instance.config.title) {
            ctx.fillStyle = theme.text;
            ctx.font = 'bold 15px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(instance.config.title, width / 2, 24);
            chartTop = 45;
        }

        switch (instance.type) {
            case 'line': drawLineChart(ctx, width, height, chartTop, theme, instance); break;
            case 'bar': drawBarChart(ctx, width, height, chartTop, theme, instance); break;
            case 'donut': drawDonutChart(ctx, width, height, chartTop, theme, instance); break;
            case 'area': drawAreaChart(ctx, width, height, chartTop, theme, instance); break;
            case 'heatmap': drawHeatmap(ctx, width, height, chartTop, theme, instance); break;
            case 'horizontalBar': drawHorizontalBarChart(ctx, width, height, chartTop, theme, instance); break;
            case 'gauge': drawGauge(ctx, width, height, chartTop, theme, instance); break;
        }
    }

    // Line Chart
    function drawLineChart(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const padding = { top: chartTop + 10, right: 35, bottom: 45, left: 60 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;
        
        // Find max value
        let maxVal = 0;
        config.datasets.forEach(ds => {
            ds.data.forEach(val => maxVal = Math.max(maxVal, val));
        });
        maxVal = maxVal * 1.1; // 10% headroom

        // Draw Grid and Y-axis
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 1;
        ctx.fillStyle = theme.textMuted;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const y = padding.top + h - (i / ySteps) * h;
            const val = (maxVal * (i / ySteps)).toFixed(0);
            
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            
            ctx.fillText(val, padding.left - 10, y);
        }

        // Draw X-axis
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xStep = w / Math.max(1, config.labels.length - 1);
        const labelInterval = config.labels.length > 12 ? Math.ceil(config.labels.length / 6) : 1;
        
        config.labels.forEach((label, i) => {
            if (i % labelInterval === 0 || i === config.labels.length - 1) {
                const x = padding.left + i * xStep;
                ctx.fillText(label, x, height - padding.bottom + 10);
            }
        });

        // Draw Lines
        let hoverTooltip = null;

        config.datasets.forEach((ds, dsIdx) => {
            const color = ds.color || CHART_COLORS[dsIdx % CHART_COLORS.length];
            
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            const points = ds.data.map((val, i) => ({
                x: padding.left + i * xStep,
                y: padding.top + h - (val / maxVal) * h
            }));
            
            // Animation clipping
            ctx.save();
            ctx.beginPath();
            ctx.rect(padding.left - 5, padding.top - 5, (w + 10) * progress, h + 10);
            ctx.clip();

            if (points.length > 0) {
                ctx.moveTo(points[0].x, points[0].y);
                
                // Draw smooth curve
                for (let i = 0; i < points.length - 1; i++) {
                    const p0 = (i > 0) ? points[i - 1] : points[0];
                    const p1 = points[i];
                    const p2 = points[i + 1];
                    const p3 = (i != points.length - 2) ? points[i + 2] : p2;

                    const cp1x = p1.x + (p2.x - p0.x) / 6;
                    const cp1y = p1.y + (p2.y - p0.y) / 6;
                    const cp2x = p2.x - (p3.x - p1.x) / 6;
                    const cp2y = p2.y - (p3.y - p1.y) / 6;
                    
                    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
                }
                ctx.stroke();
                
                // Draw dots
                ctx.fillStyle = theme.bg;
                points.forEach((p, i) => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    
                    // Hover check
                    if (mousePos.x > 0 && Math.abs(mousePos.x - p.x) < 20 && Math.abs(mousePos.y - p.y) < 20) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                        
                        hoverTooltip = {
                            x: p.x, y: p.y,
                            label: config.labels[i],
                            value: ds.data[i],
                            dsLabel: ds.label,
                            color: color
                        };
                    }
                });
            }
            ctx.restore();
        });

        if (hoverTooltip && progress > 0.9) {
            drawTooltip(ctx, hoverTooltip, theme);
        }
    }

    // Bar Chart
    function drawBarChart(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const padding = { top: chartTop, right: 30, bottom: 40, left: 50 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;
        
        let maxVal = 0;
        config.datasets.forEach(ds => {
            ds.data.forEach(val => maxVal = Math.max(maxVal, val));
        });
        maxVal = maxVal * 1.1;

        // Grid & Y-axis
        ctx.strokeStyle = theme.grid;
        ctx.fillStyle = theme.textMuted;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const y = padding.top + h - (i / ySteps) * h;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.fillText((maxVal * (i / ySteps)).toFixed(0), padding.left - 10, y);
        }

        const groupCount = config.labels.length;
        const datasetCount = config.datasets.length;
        const groupWidth = w / groupCount;
        const barWidth = (groupWidth * 0.8) / datasetCount;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        let hoverTooltip = null;

        for (let i = 0; i < groupCount; i++) {
            const groupX = padding.left + i * groupWidth + (groupWidth * 0.1);
            ctx.fillStyle = theme.textMuted;
            ctx.fillText(config.labels[i], padding.left + i * groupWidth + groupWidth/2, height - padding.bottom + 10);
            
            for (let j = 0; j < datasetCount; j++) {
                const ds = config.datasets[j];
                const val = ds.data[i] || 0;
                const barH = (val / maxVal) * h * progress;
                const x = groupX + j * barWidth;
                const y = padding.top + h - barH;
                const color = ds.color || CHART_COLORS[j % CHART_COLORS.length];
                
                // Hover effect
                let isHovered = false;
                if (mousePos.x >= x && mousePos.x <= x + barWidth - 2 && 
                    mousePos.y >= y && mousePos.y <= padding.top + h) {
                    isHovered = true;
                    hoverTooltip = {
                        x: x + barWidth/2, y: y,
                        label: config.labels[i],
                        value: val,
                        dsLabel: ds.label,
                        color: color
                    };
                }

                ctx.fillStyle = isHovered ? lightenColor(color, 20) : color;
                
                // Draw rounded top bar
                ctx.beginPath();
                const radius = Math.min(4, barWidth / 2, barH);
                ctx.moveTo(x, padding.top + h);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.lineTo(x + barWidth - 2 - radius, y);
                ctx.quadraticCurveTo(x + barWidth - 2, y, x + barWidth - 2, y + radius);
                ctx.lineTo(x + barWidth - 2, padding.top + h);
                ctx.fill();
            }
        }

        if (hoverTooltip && progress > 0.9) {
            drawTooltip(ctx, hoverTooltip, theme);
        }
    }

    // Donut Chart
    function drawDonutChart(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const cx = width / 2;
        const cy = chartTop + (height - chartTop - 40) / 2;
        const radius = Math.max(25, Math.min(cx, Math.max(30, cy - chartTop)) * 0.8);
        const innerRadius = Math.max(12, radius * 0.6);
        
        const total = config.data.reduce((a, b) => a + b, 0);
        let currentAngle = -Math.PI / 2;
        
        let hoverTooltip = null;

        config.data.forEach((val, i) => {
            const sliceAngle = (val / total) * Math.PI * 2 * progress;
            const color = config.colors?.[i] || CHART_COLORS[i % CHART_COLORS.length];
            
            // Check hover
            let isHovered = false;
            const dx = mousePos.x - cx;
            const dy = mousePos.y - cy;
            const dist = Math.sqrt(dx*dx + dy*dy);
            let mouseAngle = Math.atan2(dy, dx);
            if (mouseAngle < -Math.PI/2) mouseAngle += Math.PI * 2;
            
            if (dist >= innerRadius && dist <= radius) {
                const mAngleNormalized = mouseAngle;
                const startA = currentAngle;
                const endA = currentAngle + sliceAngle;
                if (mAngleNormalized >= startA && mAngleNormalized <= endA) {
                    isHovered = true;
                    hoverTooltip = {
                        x: mousePos.x, y: mousePos.y - 10,
                        label: config.labels[i],
                        value: val,
                        color: color
                    };
                }
            }
            
            const rOffset = isHovered ? 5 : 0;
            
            ctx.beginPath();
            ctx.arc(cx, cy, radius + rOffset, currentAngle, currentAngle + sliceAngle);
            ctx.arc(cx, cy, innerRadius - (isHovered?2:0), currentAngle + sliceAngle, currentAngle, true);
            ctx.fillStyle = color;
            ctx.fill();
            
            // Gap line
            ctx.strokeStyle = theme.bg;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            currentAngle += sliceAngle;
        });

        // Center text
        ctx.fillStyle = theme.text;
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(total.toString(), cx, cy - 8);
        
        ctx.fillStyle = theme.textMuted;
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText("Total Books", cx, cy + 12);

        // Centered wrapping Legend
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '11px Inter, sans-serif';
        
        const totalItems = config.labels.length;
        const itemsPerRow = Math.min(totalItems, 4);
        let currX = (width - (itemsPerRow * 60)) / 2;
        let currY = height - 25;

        config.labels.forEach((label, i) => {
            const color = config.colors?.[i] || CHART_COLORS[i % CHART_COLORS.length];
            const textW = ctx.measureText(label).width;
            
            if (currX + textW + 20 > width - 15) {
                currX = 20;
                currY += 16;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(currX + 4, currY, 4, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = theme.textMuted;
            ctx.fillText(label, currX + 12, currY);
            currX += textW + 24;
        });

        if (hoverTooltip && progress > 0.9) {
            drawTooltip(ctx, hoverTooltip, theme);
        }
    }

    // Area Chart
    function drawAreaChart(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const padding = { top: chartTop, right: 30, bottom: 40, left: 50 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;
        
        let maxVal = Math.max(...config.data) * 1.1;

        // Grid
        ctx.strokeStyle = theme.grid;
        ctx.fillStyle = theme.textMuted;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const y = padding.top + h - (i / ySteps) * h;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.fillText((maxVal * (i / ySteps)).toFixed(0), padding.left - 10, y);
        }

        // X-axis
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xStep = w / Math.max(1, config.labels.length - 1);
        config.labels.forEach((label, i) => {
            ctx.fillText(label, padding.left + i * xStep, height - padding.bottom + 10);
        });

        const color = config.color || CHART_COLORS[0];
        const points = config.data.map((val, i) => ({
            x: padding.left + i * xStep,
            y: padding.top + h - (val / maxVal) * h
        }));

        ctx.save();
        ctx.beginPath();
        ctx.rect(padding.left, padding.top, w * progress, h);
        ctx.clip();

        if (points.length > 0) {
            // Draw Area
            ctx.beginPath();
            ctx.moveTo(points[0].x, padding.top + h);
            ctx.lineTo(points[0].x, points[0].y);
            
            for (let i = 0; i < points.length - 1; i++) {
                const xc = (points[i].x + points[i + 1].x) / 2;
                const yc = (points[i].y + points[i + 1].y) / 2;
                ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }
            ctx.quadraticCurveTo(points[points.length-1].x, points[points.length-1].y, points[points.length-1].x, points[points.length-1].y);
            
            ctx.lineTo(points[points.length-1].x, padding.top + h);
            ctx.closePath();

            const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
            gradient.addColorStop(0, hexToRgba(color, config.fillOpacity || 0.4));
            gradient.addColorStop(1, hexToRgba(color, 0.0));
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw Line
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const xc = (points[i].x + points[i + 1].x) / 2;
                const yc = (points[i].y + points[i + 1].y) / 2;
                ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }
            ctx.quadraticCurveTo(points[points.length-1].x, points[points.length-1].y, points[points.length-1].x, points[points.length-1].y);
            
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Points & Hover
            let hoverTooltip = null;
            ctx.fillStyle = theme.bg;
            points.forEach((p, i) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();

                if (mousePos.x > 0 && Math.abs(mousePos.x - p.x) < 20 && Math.abs(mousePos.y - p.y) < 20) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 6, 0, Math.PI*2);
                    ctx.fill();
                    ctx.stroke();
                    hoverTooltip = {
                        x: p.x, y: p.y,
                        label: config.labels[i],
                        value: config.data[i],
                        color: color
                    };
                }
            });
            if (hoverTooltip && progress > 0.9) drawTooltip(ctx, hoverTooltip, theme);
        }
        ctx.restore();
    }

    // Heatmap
    function drawHeatmap(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const padding = { top: chartTop, right: 20, bottom: 40, left: 60 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;

        const rows = config.rowLabels.length;
        const cols = config.colLabels.length;
        const cellW = w / cols;
        const cellH = h / rows;

        let maxVal = 0;
        config.data.forEach(row => row.forEach(val => maxVal = Math.max(maxVal, val)));
        
        ctx.fillStyle = theme.textMuted;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        // Rows labels
        config.rowLabels.forEach((lbl, i) => {
            ctx.fillText(lbl, padding.left - 10, padding.top + i * cellH + cellH/2);
        });

        // Col labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const colInterval = Math.ceil(cols / 6);
        config.colLabels.forEach((lbl, i) => {
            if (i % colInterval === 0 || i === cols - 1) {
                ctx.fillText(lbl, padding.left + i * cellW + cellW/2, height - padding.bottom + 8);
            }
        });

        const baseColor = Array.isArray(config.colorScale) && typeof config.colorScale[0] === 'number' ? config.colorScale : [37, 99, 235];
        let hoverTooltip = null;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const val = config.data[r][c];
                const intensity = (val / maxVal) * progress;
                const x = padding.left + c * cellW;
                const y = padding.top + r * cellH;

                let isHover = false;
                if (mousePos.x > x && mousePos.x < x + cellW && mousePos.y > y && mousePos.y < y + cellH) {
                    isHover = true;
                    hoverTooltip = {
                        x: x + cellW/2, y: y,
                        label: `${config.rowLabels[r]} - ${config.colLabels[c]}`,
                        value: val,
                        color: `rgb(${baseColor.join(',')})`
                    };
                }

                if (val > 0) {
                    ctx.fillStyle = `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${Math.max(0.1, intensity)})`;
                } else {
                    ctx.fillStyle = theme.grid;
                    ctx.globalAlpha = 0.3;
                }
                
                ctx.beginPath();
                const margin = 2;
                ctx.roundRect ? ctx.roundRect(x + margin, y + margin, cellW - margin*2, cellH - margin*2, 2) 
                             : ctx.rect(x + margin, y + margin, cellW - margin*2, cellH - margin*2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
                
                if (isHover) {
                    ctx.strokeStyle = theme.text;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
        if (hoverTooltip && progress > 0.9) drawTooltip(ctx, hoverTooltip, theme);
    }

    // Horizontal Bar
    function drawHorizontalBarChart(ctx, width, height, chartTop, theme, instance) {
        const { config, progress, mousePos } = instance;
        const padding = { top: chartTop, right: 50, bottom: 20, left: 100 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;
        
        let maxVal = Math.max(...config.data) * 1.1;
        const barHeight = (h / config.labels.length) * 0.7;
        const spacing = (h / config.labels.length);

        ctx.textBaseline = 'middle';
        let hoverTooltip = null;

        config.labels.forEach((label, i) => {
            const y = padding.top + i * spacing + spacing/2;
            
            // Label
            ctx.textAlign = 'right';
            ctx.fillStyle = theme.textMuted;
            ctx.font = '12px Inter, sans-serif';
            // truncate label if too long
            let lbl = label;
            if (ctx.measureText(lbl).width > padding.left - 10) lbl = lbl.substring(0, 10) + '...';
            ctx.fillText(lbl, padding.left - 10, y);

            // Bar background
            ctx.fillStyle = theme.grid;
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(padding.left, y - barHeight/2, w, barHeight, barHeight/2)
                         : ctx.rect(padding.left, y - barHeight/2, w, barHeight);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Bar fill
            const val = config.data[i];
            const barW = (val / maxVal) * w * progress;
            const color = config.colors?.[i] || CHART_COLORS[i % CHART_COLORS.length];
            
            let isHover = false;
            if (mousePos.x > padding.left && mousePos.x < padding.left + w && 
                mousePos.y > y - barHeight/2 && mousePos.y < y + barHeight/2) {
                isHover = true;
                hoverTooltip = {
                    x: mousePos.x, y: y - barHeight/2,
                    label: label,
                    value: val,
                    color: color
                };
            }

            ctx.fillStyle = isHover ? lightenColor(color, 20) : color;
            ctx.beginPath();
            if (barW > 0) {
                ctx.roundRect ? ctx.roundRect(padding.left, y - barHeight/2, barW, barHeight, barHeight/2)
                             : ctx.rect(padding.left, y - barHeight/2, barW, barHeight);
                ctx.fill();
            }

            // Value text
            ctx.textAlign = 'left';
            ctx.fillStyle = theme.text;
            ctx.fillText(val, padding.left + barW + 10, y);
        });

        if (hoverTooltip && progress > 0.9) drawTooltip(ctx, hoverTooltip, theme);
    }

    // Gauge
    function drawGauge(ctx, width, height, chartTop, theme, instance) {
        const { config, progress } = instance;
        const cx = width / 2;
        const cy = height - 20; // Bottom center
        const radius = Math.max(20, Math.min(cx - 20, Math.max(30, (height - chartTop) * 0.75)));
        
        const color = config.color || CHART_COLORS[0];
        const valProgress = (config.value / config.max) * progress;
        
        ctx.lineCap = 'round';
        
        // Background track
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, 0);
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 15;
        ctx.stroke();
        
        // Value fill
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, Math.PI + (Math.PI * valProgress));
        ctx.strokeStyle = color;
        ctx.lineWidth = 15;
        ctx.stroke();

        // Center text
        ctx.textAlign = 'center';
        ctx.fillStyle = theme.text;
        ctx.font = 'bold 32px Inter, sans-serif';
        ctx.fillText(Math.floor(config.value * progress), cx, cy - 20);
        
        if (config.label) {
            ctx.fillStyle = theme.textMuted;
            ctx.font = '14px Inter, sans-serif';
            ctx.fillText(config.label, cx, cy + 15);
        }
    }

    // Tooltip Helper
    function drawTooltip(ctx, info, theme) {
        const p = 8;
        ctx.font = '12px Inter, sans-serif';
        
        let text1 = info.label;
        let text2 = `${info.dsLabel ? info.dsLabel + ': ' : ''}${info.value}`;
        
        const w1 = ctx.measureText(text1).width;
        const w2 = ctx.measureText(text2).width;
        const w = Math.max(w1, w2) + p * 2 + 15; // 15 for color box
        const h = 40;
        
        let tx = info.x - w / 2;
        let ty = info.y - h - 10;
        
        // Bounds check
        if (tx < 0) tx = 0;
        if (ty < 0) ty = info.y + 20;

        ctx.fillStyle = theme.tooltipBg;
        ctx.strokeStyle = theme.tooltipBorder;
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(tx, ty, w, h, 4) : ctx.rect(tx, ty, w, h);
        ctx.fill();
        ctx.stroke();
        
        // Color box
        ctx.fillStyle = info.color;
        ctx.fillRect(tx + p, ty + p + 14, 10, 10);
        
        ctx.fillStyle = theme.tooltipText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillText(text1, tx + p, ty + p);
        
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(text2, tx + p + 15, ty + p + 14);
    }

    // Utils
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function lightenColor(color, percent) {
        let r, g, b;
        if (color.startsWith('#')) {
            r = parseInt(color.slice(1, 3), 16);
            g = parseInt(color.slice(3, 5), 16);
            b = parseInt(color.slice(5, 7), 16);
        } else if (color.startsWith('rgb')) {
            const vals = color.match(/\d+/g);
            r = parseInt(vals[0]); g = parseInt(vals[1]); b = parseInt(vals[2]);
        } else return color;
        
        r = Math.min(255, Math.floor(r * (1 + percent/100)));
        g = Math.min(255, Math.floor(g * (1 + percent/100)));
        b = Math.min(255, Math.floor(b * (1 + percent/100)));
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Public API
    return {
        line: (id, config) => { registerInstance(id, 'line', config); animate(id); },
        bar: (id, config) => { registerInstance(id, 'bar', config); animate(id); },
        donut: (id, config) => { registerInstance(id, 'donut', config); animate(id); },
        area: (id, config) => { registerInstance(id, 'area', config); animate(id); },
        heatmap: (id, config) => { registerInstance(id, 'heatmap', config); animate(id); },
        horizontalBar: (id, config) => { registerInstance(id, 'horizontalBar', config); animate(id); },
        gauge: (id, config) => { registerInstance(id, 'gauge', config); animate(id); },
        refresh: (id) => { if (instances[id]) renderChart(id, true); },
        destroyAll: () => {
            if (resizeObserver) resizeObserver.disconnect();
            for (let id in instances) {
                const canvas = document.getElementById(id);
                if (canvas) {
                    canvas.removeAttribute('data-chart-events');
                    // Clone to remove event listeners
                    const clone = canvas.cloneNode(true);
                    canvas.parentNode.replaceChild(clone, canvas);
                }
            }
            for (let id in instances) delete instances[id];
        }
    };
})();
