// Canvas labels need a redraw when the paper's CSS palette changes.
function updateChartTheme() {
  if (!window.Chart) return;
  const style = getComputedStyle(document.documentElement);
  const text = style.getPropertyValue('--text').trim();
  const muted = style.getPropertyValue('--muted').trim();
  const rule = style.getPropertyValue('--rule').trim();
  for (const chart of Object.values(Chart.instances)) {
    const plugins = chart.options.plugins;
    if (plugins.title) plugins.title.color = text;
    if (plugins.legend?.labels) plugins.legend.labels.color = muted;
    for (const scale of Object.values(chart.options.scales)) {
      if (scale.title) scale.title.color = muted;
      if (scale.ticks) scale.ticks.color = muted;
      if (scale.grid) scale.grid.color = rule;
      if (scale.border) scale.border.color = rule;
    }
    chart.update('none');
  }
}

window.addEventListener('reader-theme-change', updateChartTheme);
window.addEventListener('beforeprint', updateChartTheme);
window.addEventListener('afterprint', updateChartTheme);
