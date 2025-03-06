/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

// @ts-check
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import 'dotenv/config';

const __dirname = new URL('.', import.meta.url).pathname;

// Configuration
const GRAFANA_DASHBOARD_URL = process.env.GRAFANA_DASHBOARD_URL;
const GRAFANA_SERVICE_ACCOUNT_TOKEN = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;
const OUTPUT_DIR = join(__dirname, '../grafana');

if (!GRAFANA_SERVICE_ACCOUNT_TOKEN) {
  console.error('Error: GRAFANA_SERVICE_ACCOUNT_TOKEN environment variable is not set');
  process.exit(1);
}

// Create output directory if it doesn't exist
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Utility to create unique IDs for panels
let panelIdCounter = 1;
const nextPanelId = () => panelIdCounter++;

// Generate InterChat dashboard based on our metrics
async function generateDashboard() {
  console.log('Generating InterChat Dashboard...');

  const dashboard = {
    title: 'InterChat Bot Metrics',
    uid: 'interchat',
    tags: ['discord', 'bot', 'interchat'],
    timezone: 'browser',
    schemaVersion: 36,
    version: 1,
    refresh: '10s',
    /** @type {any[]} */
    panels: [],
    time: {
      from: 'now-3h',
      to: 'now',
    },
    editable: true,
  };

  // Add header row
  dashboard.panels.push({
    id: nextPanelId(),
    type: 'row',
    title: 'Overview',
    collapsed: false,
    gridPos: { x: 0, y: 0, w: 24, h: 1 },
  });

  // Messages processed stat
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Messages Processed',
    type: 'stat',
    datasource: 'Prometheus',
    gridPos: { x: 6, y: 1, w: 6, h: 6 },
    options: {
      reduceOptions: { values: false, calcs: ['last'], fields: '' },
      orientation: 'vertical',
      colorMode: 'value',
      graphMode: 'area',
      justifyMode: 'auto',
    },
    fieldConfig: {
      defaults: {
        mappings: [],
        color: { mode: 'palette-classic' },
        thresholds: {
          mode: 'absolute',
          steps: [{ value: null, color: 'blue' }],
        },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'sum(increase(interchat_messages_total[24h]))',
        legendFormat: 'Messages (24h)',
        refId: 'A',
      },
    ],
  });

  // Guilds count stat
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Total Guilds',
    type: 'stat',
    datasource: 'Prometheus',
    gridPos: { x: 12, y: 1, w: 6, h: 6 },
    options: {
      reduceOptions: { values: false, calcs: ['last'], fields: '' },
      orientation: 'vertical',
      colorMode: 'value',
      graphMode: 'area',
      justifyMode: 'auto',
    },
    fieldConfig: {
      defaults: {
        mappings: [],
        color: { mode: 'palette-classic' },
        thresholds: {
          mode: 'absolute',
          steps: [{ value: null, color: 'purple' }],
        },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'sum(interchat_guilds_total)',
        legendFormat: 'Guilds',
        refId: 'A',
      },
    ],
  });

  // Hubs count stat
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Total Hubs',
    type: 'stat',
    datasource: 'Prometheus',
    gridPos: { x: 18, y: 1, w: 6, h: 6 },
    options: {
      reduceOptions: { values: false, calcs: ['last'], fields: '' },
      orientation: 'vertical',
      colorMode: 'value',
      graphMode: 'area',
      justifyMode: 'auto',
    },
    fieldConfig: {
      defaults: {
        mappings: [],
        color: { mode: 'palette-classic' },
        thresholds: {
          mode: 'absolute',
          steps: [{ value: null, color: 'orange' }],
        },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'interchat_hubs_total',
        legendFormat: 'Hubs',
        refId: 'A',
      },
    ],
  });

  // Messages time series
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Messages Over Time',
    type: 'timeseries',
    datasource: 'Prometheus',
    gridPos: { x: 12, y: 15, w: 12, h: 8 },
    options: {
      legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'single', sort: 'none' },
    },
    fieldConfig: {
      defaults: {
        custom: {
          drawStyle: 'line',
          lineInterpolation: 'linear',
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: 'none',
          spanNulls: false,
          showPoints: 'auto',
          pointSize: 5,
          stacking: { mode: 'none', group: 'A' },
          axisPlacement: 'auto',
          axisLabel: '',
          scaleDistribution: { type: 'linear' },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: 'off' },
        },
        color: { mode: 'palette-classic' },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'sum(rate(interchat_messages_total[5m])) by (hub_id)',
        legendFormat: 'Hub: {{hub_id}}',
        refId: 'A',
      },
    ],
  });

  // Cluster row
  dashboard.panels.push({
    id: nextPanelId(),
    type: 'row',
    title: 'Cluster Metrics',
    collapsed: false,
    gridPos: { x: 0, y: 23, w: 24, h: 1 },
  });

  // Guild count by cluster
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Guild Count by Cluster',
    type: 'barchart',
    datasource: 'Prometheus',
    gridPos: { x: 0, y: 16, w: 12, h: 8 },
    options: {
      orientation: 'horizontal',
      legend: { showLegend: false },
      text: { valueSize: 100 },
    },
    fieldConfig: {
      defaults: {
        custom: {
          axisCenteredZero: false,
          axisColorMode: 'text',
          axisPlacement: 'auto',
          barAlignment: 0,
          drawStyle: 'bars',
          fillOpacity: 80,
          gradientMode: 'none',
          hideFrom: { legend: false, tooltip: false, viz: false },
          lineInterpolation: 'linear',
          lineWidth: 1,
          pointSize: 5,
          scaleDistribution: { type: 'linear' },
          showPoints: 'auto',
          spanNulls: false,
          stacking: { group: 'A', mode: 'none' },
          thresholdsStyle: { mode: 'off' },
        },
        mappings: [],
        thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'interchat_guilds_total',
        legendFormat: 'Cluster {{cluster}}',
        refId: 'A',
      },
    ],
  });

  // System metrics row
  dashboard.panels.push({
    id: nextPanelId(),
    type: 'row',
    title: 'System Metrics',
    collapsed: false,
    gridPos: { x: 0, y: 24, w: 24, h: 1 },
  });

  // CPU Usage
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'CPU Usage',
    type: 'timeseries',
    datasource: 'Prometheus',
    gridPos: { x: 0, y: 25, w: 12, h: 8 },
    options: {
      legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'single', sort: 'none' },
    },
    fieldConfig: {
      defaults: {
        custom: {
          drawStyle: 'line',
          lineInterpolation: 'linear',
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: 'none',
          spanNulls: false,
          showPoints: 'auto',
          pointSize: 5,
          stacking: { mode: 'none', group: 'A' },
          axisPlacement: 'auto',
          axisLabel: '',
          scaleDistribution: { type: 'linear' },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: 'off' },
        },
        color: { mode: 'palette-classic' },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'rate(process_cpu_seconds_total[1m]) * 100',
        legendFormat: 'CPU %',
        refId: 'A',
      },
    ],
  });

  // Memory Usage
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Memory Usage',
    type: 'timeseries',
    datasource: 'Prometheus',
    gridPos: { x: 12, y: 25, w: 12, h: 8 },
    options: {
      legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'single', sort: 'none' },
    },
    fieldConfig: {
      defaults: {
        custom: {
          drawStyle: 'line',
          lineInterpolation: 'linear',
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: 'none',
          spanNulls: false,
          showPoints: 'auto',
          pointSize: 5,
          stacking: { mode: 'none', group: 'A' },
          axisPlacement: 'auto',
          axisLabel: '',
          scaleDistribution: { type: 'linear' },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: 'off' },
        },
        color: { mode: 'palette-classic' },
        unit: 'bytes',
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'process_resident_memory_bytes',
        legendFormat: 'Memory',
        refId: 'A',
      },
    ],
  });

  // Commands time series
  dashboard.panels.push({
    id: nextPanelId(),
    title: 'Commands Over Time',
    type: 'timeseries',
    datasource: 'Prometheus',
    gridPos: { x: 0, y: 7, w: 12, h: 8 },
    options: {
      legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'single', sort: 'none' },
    },
    fieldConfig: {
      defaults: {
        custom: {
          drawStyle: 'line',
          lineInterpolation: 'linear',
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: 'none',
          spanNulls: false,
          showPoints: 'auto',
          pointSize: 5,
          stacking: { mode: 'none', group: 'A' },
          axisPlacement: 'auto',
          axisLabel: '',
          scaleDistribution: { type: 'linear' },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: 'off' },
        },
        color: { mode: 'palette-classic' },
      },
      overrides: [],
    },
    targets: [
      {
        expr: 'sum(rate(interchat_command_usage_total[5m])) by (command)',
        legendFormat: '{{command}}',
        refId: 'A',
      },
    ],
  });

  dashboard.panels.push({
    id: nextPanelId(),
    type: 'piechart',
    title: 'Command Usage By Name',
    gridPos: {
      x: 0,
      y: 7,
      h: 8,
      w: 12,
    },
    fieldConfig: {
      defaults: {
        custom: {
          hideFrom: {
            tooltip: false,
            viz: false,
            legend: false,
          },
        },
        color: {
          mode: 'palette-classic',
        },
        mappings: [],
      },
      overrides: [],
    },
    pluginVersion: '11.6.0-83314',
    targets: [
      {
        editorMode: 'builder',
        exemplar: false,
        expr: 'topk(10, sum by(command_name) (interchat_command_usage_total))',
        format: 'time_series',
        instant: true,
        legendFormat: '{{command_name}}',
        range: false,
        refId: 'A',
      },
    ],
    datasource: {
      type: 'prometheus',
      uid: 'grafanacloud-prom',
    },
    options: {
      reduceOptions: {
        values: false,
        calcs: ['lastNotNull'],
        fields: '',
      },
      pieType: 'pie',
      tooltip: {
        mode: 'single',
        sort: 'none',
        hideZeros: false,
      },
      legend: {
        showLegend: true,
        displayMode: 'list',
        placement: 'bottom',
      },
    },
  });

  // Save dashboard JSON to file
  const dashboardOutput = join(OUTPUT_DIR, 'interchat-dashboard.json');
  writeFileSync(dashboardOutput, JSON.stringify(dashboard, null, 2));
  console.log(`Dashboard JSON saved to ${dashboardOutput}`);

  // Deploy to Grafana if possible
  if (GRAFANA_SERVICE_ACCOUNT_TOKEN) {
    try {
      await deployToGrafana(dashboard);
    } catch (error) {
      console.error('Failed to deploy dashboard to Grafana:', error.message);
    }
  }

  return dashboard;
}

// Deploy dashboard to Grafana
/**
 *
 * @param {{title: string; uid?: string;panels: Array<{id: number;type: string;title: string;[key: string]: any;}>;[key: string]: any;}} dashboard
 * @returns
 */
async function deployToGrafana(dashboard) {
  console.log(`Deploying dashboard to Grafana at ${GRAFANA_DASHBOARD_URL}...`);

  const payload = {
    dashboard,
    folderId: 0,
    overwrite: true,
  };

  try {
    const response = await axios.post(`${GRAFANA_DASHBOARD_URL}/api/dashboards/db`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}`,
      },
    });

    console.log(`Dashboard deployed successfully: ${response.data.url}`);
    console.log(`View dashboard at: ${GRAFANA_DASHBOARD_URL}${response.data.url}`);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`Grafana API error (${error.response.status}):`, error.response.data);
    }
    throw error;
  }
}

// Run the script
generateDashboard().catch((err) => {
  console.error('Error generating dashboard:', err);
  process.exit(1);
});
