/* RED HTML 3D Review - software Canvas 2D fallback
 *
 * This renderer is used only when Qt WebEngine cannot create a WebGL context.
 * It consumes the same immutable scene payload and exposes the same RED3D API
 * as the WebGL renderer.  It performs CPU-side projection, painter sorting,
 * lighting and surface probing, so RED remains usable on blocked GPUs, remote
 * desktop sessions and conservative QGIS/Chromium graphics configurations.
 */
(function () {
  "use strict";

  const ELEMENT_COLOURS = [
    [0.00, 0.76, 0.93],
    [0.31, 0.67, 0.34],
    [0.95, 0.77, 0.20],
    [0.94, 0.29, 0.38],
    [0.69, 0.46, 0.84],
    [0.93, 0.52, 0.20],
    [0.12, 0.78, 0.58],
    [0.53, 0.69, 0.76],
    [0.66, 0.70, 0.73]
  ];

  const SOFTWARE_TRIANGLE_BUDGET = 30000;

  function createSoftwareRenderer() {
    const canvas = document.getElementById("gl-canvas");
    const emptyState = document.getElementById("empty-state");
    const emptyMessage = document.getElementById("empty-message");
    const sceneHud = document.getElementById("scene-hud");
    const scenarioName = document.getElementById("scenario-name");
    const sceneSummary = document.getElementById("scene-summary");
    const sceneCrs = document.getElementById("scene-crs");
    const warningPanel = document.getElementById("warning-panel");
    const warningList = document.getElementById("warning-list");
    const legend = document.getElementById("legend");
    const legendTitle = document.getElementById("legend-title");
    const legendItems = document.getElementById("legend-items");
    const inspector = document.getElementById("inspector");
    const inspectorValues = document.getElementById("inspector-values");
    const inspectorClose = document.getElementById("inspector-close");
    const openSection = document.getElementById("open-section");
    const interactionHelp = document.getElementById("interaction-help");
    const axisGizmo = document.getElementById("axis-gizmo");

    const context = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    if (!context) {
      emptyMessage.textContent = "Neither WebGL nor HTML Canvas 2D is available in this QGIS web engine.";
      emptyState.classList.remove("hidden");
      return createUnavailableApi();
    }

    canvas.dataset.renderer = "canvas2d";

    const state = {
      scene: null,
      meshes: [],
      lines: [],
      cylinders: [],
      grid: null,
      bridge: null,
      selectedSectionId: "",
      colorMode: "elements",
      verticalExaggeration: 1.0,
      projection: "perspective",
      wireframe: false,
      designOpacity: 1.0,
      existingOpacity: 0.55,
      displayStyle: "engineering",
      lighting: "overcast",
      condition: "engineering",
      imageryVisible: false,
      savedCamera: null,
      visibility: {
        design: true,
        existing: true,
        breaklines: true,
        piles: true,
        rock: true,
        large_wood: true,
        vegetation: true,
        structures: true,
        grid: true
      },
      camera: {
        target: [0, 0, 0],
        yaw: -0.72,
        pitch: 0.56,
        distance: 100,
        orthoScale: 100,
        near: 0.01,
        far: 10000
      },
      viewMatrix: mat4Identity(),
      projectionMatrix: mat4Identity(),
      viewProjectionMatrix: mat4Identity(),
      renderPending: false,
      pointer: null,
      deviceScale: 1,
      elevationRange: [0, 1],
      renderStride: 1,
      totalTriangles: 0
    };

    emptyMessage.textContent = "WebGL is unavailable. Starting RED's software 3D renderer...";

    function createUnavailableApi() {
      const noop = function () { return false; };
      return {
        loadScene: noop,
        setVisibility: noop,
        setLayerVisibility: noop,
        setColorMode: noop,
        setVerticalExaggeration: noop,
        setProjection: noop,
        setOpacity: noop,
        setDisplayStyle: noop,
        setLighting: noop,
        setCondition: noop,
        setImageryVisible: noop,
        setCameraPreset: noop,
        getCamera: function () { return null; },
        setCamera: noop,
        saveView: noop,
        recallView: noop,
        setWireframe: noop,
        fitView: noop,
        topView: noop,
        getLayers: function () { return []; },
        getLayerGroups: function () { return {}; },
        getState: function () {
          return { ready: false, webgl: false, backend: "unavailable" };
        }
      };
    }

    function mat4Identity() {
      return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ]);
    }

    function mat4Multiply(a, b) {
      const out = new Float32Array(16);
      for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
          out[column * 4 + row] =
            a[row] * b[column * 4] +
            a[4 + row] * b[column * 4 + 1] +
            a[8 + row] * b[column * 4 + 2] +
            a[12 + row] * b[column * 4 + 3];
        }
      }
      return out;
    }

    function mat4Perspective(fovY, aspect, near, far) {
      const f = 1.0 / Math.tan(fovY / 2.0);
      const out = new Float32Array(16);
      out[0] = f / Math.max(aspect, 0.0001);
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = (2 * far * near) / (near - far);
      return out;
    }

    function mat4Ortho(left, right, bottom, top, near, far) {
      const out = mat4Identity();
      out[0] = 2 / (right - left);
      out[5] = 2 / (top - bottom);
      out[10] = -2 / (far - near);
      out[12] = -(right + left) / (right - left);
      out[13] = -(top + bottom) / (top - bottom);
      out[14] = -(far + near) / (far - near);
      return out;
    }

    function mat4LookAt(eye, target, up) {
      const z = vec3Normalize(vec3Subtract(eye, target));
      let x = vec3Normalize(vec3Cross(up, z));
      if (vec3Length(x) < 1e-8) {
        x = [1, 0, 0];
      }
      const y = vec3Cross(z, x);
      const out = mat4Identity();
      out[0] = x[0];
      out[1] = y[0];
      out[2] = z[0];
      out[4] = x[1];
      out[5] = y[1];
      out[6] = z[1];
      out[8] = x[2];
      out[9] = y[2];
      out[10] = z[2];
      out[12] = -vec3Dot(x, eye);
      out[13] = -vec3Dot(y, eye);
      out[14] = -vec3Dot(z, eye);
      return out;
    }

    function mat4Invert(a) {
      const out = new Float32Array(16);
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10;
      const b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11;
      const b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30;
      const b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31;
      const b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    }

    function transformVec4(matrix, vector) {
      return [
        matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2] + matrix[12] * vector[3],
        matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2] + matrix[13] * vector[3],
        matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2] + matrix[14] * vector[3],
        matrix[3] * vector[0] + matrix[7] * vector[1] + matrix[11] * vector[2] + matrix[15] * vector[3]
      ];
    }

    function vec3Add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function vec3Subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function vec3Scale(a, scalar) { return [a[0] * scalar, a[1] * scalar, a[2] * scalar]; }
    function vec3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function vec3Cross(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }
    function vec3Length(a) { return Math.sqrt(vec3Dot(a, a)); }
    function vec3Normalize(a) {
      const length = vec3Length(a);
      return length > 1e-12 ? vec3Scale(a, 1 / length) : [0, 1, 0];
    }
    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
    }
    function mix(a, b, t) { return a + (b - a) * t; }

    function layerGroupForRole(role) {
      const value = String(role || "");
      if (value === "pile_field_alignments") {
        return "piles";
      }
      if (value === "pile_scour" || value === "pile_scour_protection") {
        return "rock";
      }
      if (value === "rock_toe" || value === "rock_toe_filter" || value === "rock_structure" || value === "rock_structure_filter") {
        return "rock";
      }
      if (value.indexOf("large_wood") === 0) {
        return "large_wood";
      }
      return "";
    }

    function structureVisibility(group) {
      if (!state.visibility.structures) {
        return false;
      }
      const key = String(group || "");
      if (key && Object.prototype.hasOwnProperty.call(state.visibility, key)) {
        return Boolean(state.visibility[key]);
      }
      return true;
    }

    function mixColour(a, b, t) {
      return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
    }

    function parseColour(value, fallback) {
      const text = typeof value === "string" ? value.trim() : "";
      const match = /^#([0-9a-f]{6})$/i.exec(text);
      if (!match) {
        return fallback ? fallback.slice() : [0.7, 0.72, 0.74];
      }
      const number = parseInt(match[1], 16);
      return [
        ((number >> 16) & 255) / 255,
        ((number >> 8) & 255) / 255,
        (number & 255) / 255
      ];
    }

    function colourCss(colour, alpha) {
      const values = colour.map(function (value) {
        return Math.round(clamp(value, 0, 1) * 255);
      });
      if (alpha == null || alpha >= 0.999) {
        return "rgb(" + values.join(",") + ")";
      }
      return "rgba(" + values.join(",") + "," + clamp(alpha, 0, 1).toFixed(3) + ")";
    }

    function dataToRenderPoint(x, y, z) {
      return [x, z * state.verticalExaggeration, -y];
    }

    function convertPositions(source) {
      const output = new Float64Array(source.length);
      for (let index = 0; index + 2 < source.length; index += 3) {
        output[index] = Number(source[index]) || 0;
        output[index + 1] = (Number(source[index + 2]) || 0) * state.verticalExaggeration;
        output[index + 2] = -(Number(source[index + 1]) || 0);
      }
      return output;
    }

    function buildNormals(positions, indices) {
      const normals = new Float64Array(positions.length);
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const ia = indices[index] * 3;
        const ib = indices[index + 1] * 3;
        const ic = indices[index + 2] * 3;
        const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
        const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
        const c = [positions[ic], positions[ic + 1], positions[ic + 2]];
        const normal = vec3Cross(vec3Subtract(b, a), vec3Subtract(c, a));
        [ia, ib, ic].forEach(function (vertexIndex) {
          normals[vertexIndex] += normal[0];
          normals[vertexIndex + 1] += normal[1];
          normals[vertexIndex + 2] += normal[2];
        });
      }
      for (let index = 0; index + 2 < normals.length; index += 3) {
        let normal = vec3Normalize([normals[index], normals[index + 1], normals[index + 2]]);
        if (normal[1] < 0) {
          normal = vec3Scale(normal, -1);
        }
        normals[index] = normal[0];
        normals[index + 1] = normal[1];
        normals[index + 2] = normal[2];
      }
      return normals;
    }

    function computeDataElevationRange(meshes) {
      let minimum = Infinity;
      let maximum = -Infinity;
      meshes.forEach(function (mesh) {
        if (mesh.role !== "design") {
          return;
        }
        for (let index = 2; index < mesh.sourcePositions.length; index += 3) {
          const value = Number(mesh.sourcePositions[index]);
          if (Number.isFinite(value)) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
          }
        }
      });
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
        return [0, 1];
      }
      if (Math.abs(maximum - minimum) < 1e-9) {
        return [minimum - 0.5, maximum + 0.5];
      }
      return [minimum, maximum];
    }

    function cutFillTolerance() {
      const stats = state.scene && state.scene.statistics ? state.scene.statistics : {};
      const value = Number(stats.cut_fill_tolerance);
      return Number.isFinite(value) && value >= 0 ? value : 0.02;
    }

    function earthworksLabel(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return "n/a";
      }
      const tolerance = cutFillTolerance();
      if (number < -tolerance) {
        return "Cut " + Math.abs(number).toFixed(3) + " m";
      }
      if (number > tolerance) {
        return "Fill " + number.toFixed(3) + " m";
      }
      return "Neutral " + signedNumber(number, 3) + " m";
    }

    function designVertexColour(mesh, vertexIndex) {
      if (state.colorMode === "elements") {
        const code = mesh.element && Number.isFinite(Number(mesh.element[vertexIndex]))
          ? Number(mesh.element[vertexIndex])
          : ELEMENT_COLOURS.length - 1;
        if (state.displayStyle === "natural") {
          const natural = [
            [0.43, 0.34, 0.22], [0.39, 0.52, 0.27], [0.46, 0.58, 0.30],
            [0.48, 0.42, 0.28], [0.45, 0.55, 0.29], [0.42, 0.49, 0.27],
            [0.37, 0.52, 0.29], [0.44, 0.48, 0.31], [0.45, 0.47, 0.35]
          ];
          let colour = (natural[code] || natural[natural.length - 1]).slice();
          if (state.condition === "early") {
            colour = mixColour(colour, [0.52, 0.46, 0.31], 0.38);
          } else if (state.condition === "established") {
            colour = mixColour(colour, [0.25, 0.50, 0.23], 0.48);
          }
          return colour;
        }
        if (state.displayStyle === "construction") {
          const construction = [
            [0.57, 0.43, 0.29], [0.62, 0.48, 0.32], [0.69, 0.55, 0.36],
            [0.72, 0.50, 0.29], [0.65, 0.51, 0.34], [0.59, 0.45, 0.30],
            [0.55, 0.46, 0.33], [0.61, 0.51, 0.38], [0.58, 0.52, 0.42]
          ];
          return (construction[code] || construction[construction.length - 1]).slice();
        }
        return (ELEMENT_COLOURS[code] || ELEMENT_COLOURS[ELEMENT_COLOURS.length - 1]).slice();
      }
      if (state.colorMode === "cut_fill") {
        const raw = mesh.delta ? Number(mesh.delta[vertexIndex]) : NaN;
        if (!Number.isFinite(raw)) {
          return [0.64, 0.67, 0.69];
        }
        const statistics = state.scene && state.scene.statistics ? state.scene.statistics : {};
        const tolerance = cutFillTolerance();
        const maximum = Math.max(
          Math.abs(Number(statistics.minimum_delta) || 0),
          Math.abs(Number(statistics.maximum_delta) || 0),
          tolerance + 0.01
        );
        const magnitude = clamp(
          (Math.abs(raw) - tolerance) / Math.max(maximum - tolerance, 0.01),
          0,
          1
        );
        const neutral = [0.91, 0.91, 0.86];
        if (raw < -tolerance) {
          return mixColour(neutral, [0.90, 0.24, 0.15], magnitude);
        }
        if (raw > tolerance) {
          return mixColour(neutral, [0.13, 0.46, 0.90], magnitude);
        }
        return neutral;
      }
      if (state.colorMode === "elevation") {
        const z = Number(mesh.sourcePositions[vertexIndex * 3 + 2]) || 0;
        const range = state.elevationRange || [0, 1];
        const t = clamp((z - range[0]) / Math.max(range[1] - range[0], 1e-9), 0, 1);
        if (t < 0.33) {
          return mixColour([0.05, 0.34, 0.62], [0.13, 0.71, 0.74], t / 0.33);
        }
        if (t < 0.66) {
          return mixColour([0.13, 0.71, 0.74], [0.64, 0.72, 0.35], (t - 0.33) / 0.33);
        }
        return mixColour([0.64, 0.72, 0.35], [0.96, 0.87, 0.68], (t - 0.66) / 0.34);
      }
      if (state.colorMode === "slope") {
        const normalIndex = vertexIndex * 3;
        const normal = [
          mesh.normals[normalIndex],
          mesh.normals[normalIndex + 1],
          mesh.normals[normalIndex + 2]
        ];
        const degrees = Math.acos(clamp(Math.abs(normal[1]), 0, 1)) * 180 / Math.PI;
        if (degrees <= 10) {
          return mixColour([0.18, 0.62, 0.34], [0.55, 0.76, 0.30], degrees / 10);
        }
        if (degrees <= 25) {
          return mixColour([0.55, 0.76, 0.30], [0.96, 0.74, 0.20], (degrees - 10) / 15);
        }
        if (degrees <= 40) {
          return mixColour([0.96, 0.74, 0.20], [0.94, 0.39, 0.14], (degrees - 25) / 15);
        }
        return mixColour([0.94, 0.39, 0.14], [0.71, 0.10, 0.14], clamp((degrees - 40) / 25, 0, 1));
      }
      return [0.36, 0.68, 0.42];
    }

    function refreshMeshColours(mesh) {
      const vertexCount = mesh.sourcePositions.length / 3;
      const colours = new Float64Array(vertexCount * 3);
      let base = parseColour(mesh.baseColor, [0.7, 0.72, 0.74]);
      if (state.displayStyle !== "engineering") {
        if (isExistingRole(mesh.role)) {
          base = state.displayStyle === "natural" ? [0.34, 0.45, 0.27] : [0.49, 0.43, 0.32];
        } else if (mesh.role === "pile") {
          base = [0.42, 0.25, 0.12];
        } else if (/rock|scour|filter/i.test(mesh.id + " " + mesh.label)) {
          base = state.displayStyle === "natural" ? [0.43, 0.43, 0.39] : [0.52, 0.50, 0.45];
        }
      }
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const imageryIndex = vertex * 3;
        const useImagery = state.imageryVisible && isExistingRole(mesh.role) &&
          mesh.imageryValid && Number(mesh.imageryValid[vertex]) > 0 &&
          mesh.imageryColors && mesh.imageryColors.length >= imageryIndex + 3;
        const colour = useImagery
          ? [mesh.imageryColors[imageryIndex], mesh.imageryColors[imageryIndex + 1], mesh.imageryColors[imageryIndex + 2]]
          : mesh.role === "design" ? designVertexColour(mesh, vertex) : base;
        colours[vertex * 3] = colour[0];
        colours[vertex * 3 + 1] = colour[1];
        colours[vertex * 3 + 2] = colour[2];
      }
      mesh.colours = colours;
    }

    function refreshGeometry(mesh) {
      mesh.positions = convertPositions(mesh.sourcePositions);
      mesh.normals = buildNormals(mesh.positions, mesh.indices);
      refreshMeshColours(mesh);
    }

    function createMesh(raw, extra) {
      const sourcePositions = Array.isArray(raw.positions) ? raw.positions.map(Number) : [];
      const indices = Array.isArray(raw.indices) ? raw.indices.map(Number) : [];
      if (sourcePositions.length < 9 || indices.length < 3) {
        return null;
      }
      const mesh = Object.assign({
        id: String(raw.id || "mesh"),
        label: String(raw.label || raw.id || "Mesh"),
        role: String(raw.role || "structure"),
        layerGroup: String(raw.layer_group || layerGroupForRole(raw.role || "")),
        baseColor: String(raw.base_color || "#b7bcc0"),
        opacity: clamp(Number(raw.opacity), 0, 1),
        visible: raw.visible !== false,
        showWithDesign: raw.show_with_design !== false,
        sourcePositions: sourcePositions,
        indices: indices,
        delta: Array.isArray(raw.delta) ? raw.delta : null,
        existingZ: Array.isArray(raw.existing_z) ? raw.existing_z : null,
        chainage: Array.isArray(raw.chainage) ? raw.chainage : null,
        offset: Array.isArray(raw.offset) ? raw.offset : null,
        section: Array.isArray(raw.section) ? raw.section : null,
        sectionIds: Array.isArray(raw.section_ids) ? raw.section_ids.map(String) : [],
        element: Array.isArray(raw.element) ? raw.element : null,
        elementLabels: Array.isArray(raw.element_labels) ? raw.element_labels.map(String) : [],
        imageryColors: Array.isArray(raw.imagery_colors) ? raw.imagery_colors.map(Number) : null,
        imageryValid: Array.isArray(raw.imagery_valid) ? raw.imagery_valid.map(Number) : null
      }, extra || {});
      if (!Number.isFinite(mesh.opacity)) {
        mesh.opacity = 1.0;
      }
      refreshGeometry(mesh);
      return mesh;
    }

    function buildPileMesh(cylinders) {
      const positions = [];
      const indices = [];
      const sides = 12;
      cylinders.forEach(function (cylinder) {
        const base = Array.isArray(cylinder.base) ? cylinder.base.map(Number) : null;
        const top = Array.isArray(cylinder.top) ? cylinder.top.map(Number) : null;
        const radius = Number(cylinder.radius);
        if (!base || !top || base.length < 3 || top.length < 3 || !(radius > 0)) {
          return;
        }
        const first = positions.length / 3;
        for (let ring = 0; ring < 2; ring += 1) {
          const centre = ring === 0 ? base : top;
          for (let side = 0; side < sides; side += 1) {
            const angle = side * Math.PI * 2 / sides;
            positions.push(
              centre[0] + Math.cos(angle) * radius,
              centre[1] + Math.sin(angle) * radius,
              centre[2]
            );
          }
        }
        const baseCentre = positions.length / 3;
        positions.push(base[0], base[1], base[2]);
        const topCentre = positions.length / 3;
        positions.push(top[0], top[1], top[2]);
        for (let side = 0; side < sides; side += 1) {
          const next = (side + 1) % sides;
          const lowerA = first + side;
          const lowerB = first + next;
          const upperA = first + sides + side;
          const upperB = first + sides + next;
          indices.push(lowerA, lowerB, upperB, lowerA, upperB, upperA);
          indices.push(baseCentre, lowerB, lowerA);
          indices.push(topCentre, upperA, upperB);
        }
      });
      if (!indices.length) {
        return null;
      }
      const colour = cylinders.length ? String(cylinders[0].color || "#a86f32") : "#a86f32";
      return createMesh({
        id: "published-piles",
        label: "Published pile fields",
        role: "pile",
        positions: positions,
        indices: indices,
        base_color: colour,
        opacity: 1.0,
        visible: true
      });
    }

    function createLine(raw) {
      const sourcePoints = Array.isArray(raw.points) ? raw.points : [];
      if (sourcePoints.length < 2) {
        return null;
      }
      const role = String(raw.role || "breakline");
      const lineGroup = String(raw.layer_group || layerGroupForRole(role));
      const structure = Boolean(lineGroup) || role === "pile_field_alignments" || role === "pile_scour" || role === "pile_scour_protection" || role === "structure_outline";
      const line = {
        id: String(raw.id || "line"),
        label: String(raw.label || raw.id || "Line"),
        role: role,
        layerGroup: lineGroup,
        category: structure ? "structures" : "breaklines",
        sourcePoints: sourcePoints,
        positions: [],
        color: parseColour(raw.color, [0.95, 0.95, 0.95]),
        visible: raw.visible !== false
      };
      refreshLineGeometry(line);
      return line.positions.length >= 6 ? line : null;
    }

    function refreshLineGeometry(line) {
      const positions = [];
      line.sourcePoints.forEach(function (point) {
        if (!Array.isArray(point) || point.length < 3) {
          return;
        }
        const converted = dataToRenderPoint(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
        positions.push(converted[0], converted[1], converted[2]);
      });
      line.positions = positions;
    }

    function createGrid(sceneBounds) {
      const minimum = sceneBounds && Array.isArray(sceneBounds.minimum) ? sceneBounds.minimum : [-10, -10, 0];
      const maximum = sceneBounds && Array.isArray(sceneBounds.maximum) ? sceneBounds.maximum : [10, 10, 1];
      const width = Math.max(Math.abs(Number(maximum[0]) - Number(minimum[0])), 1);
      const depth = Math.max(Math.abs(Number(maximum[1]) - Number(minimum[1])), 1);
      const extent = Math.max(width, depth) * 0.72;
      const targetSpacing = extent / 10;
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetSpacing, 0.001))));
      const ratio = targetSpacing / magnitude;
      const spacing = (ratio < 2 ? 1 : ratio < 5 ? 2 : 5) * magnitude;
      const half = Math.ceil(extent / spacing) * spacing;
      const y = -Math.max(0.03 * state.verticalExaggeration, 0.015);
      const positions = [];
      const lineCount = Math.min(Math.ceil(half / spacing), 60);
      for (let index = -lineCount; index <= lineCount; index += 1) {
        const value = index * spacing;
        positions.push(-half, y, value, half, y, value);
        positions.push(value, y, -half, value, y, half);
      }
      return { positions: positions, spacing: spacing };
    }

    function refreshGrid() {
      state.grid = state.scene ? createGrid(state.scene.bounds) : null;
    }

    function clearSceneResources() {
      state.meshes = [];
      state.lines = [];
      state.cylinders = [];
      state.grid = null;
      state.totalTriangles = 0;
      state.renderStride = 1;
    }

    function loadScene(scene) {
      try {
        clearSceneResources();
        state.scene = scene && typeof scene === "object" ? scene : null;
        state.selectedSectionId = "";
        hideInspector();
        if (!state.scene || Number(state.scene.schema) !== 1) {
          showEmpty("The supplied RED 3D scene is missing or uses an unsupported schema.");
          return false;
        }
        const rawMeshes = Array.isArray(state.scene.meshes) ? state.scene.meshes : [];
        rawMeshes.forEach(function (raw) {
          const mesh = createMesh(raw);
          if (mesh) {
            state.meshes.push(mesh);
          }
        });
        state.cylinders = Array.isArray(state.scene.cylinders) ? state.scene.cylinders : [];
        const pileMesh = buildPileMesh(state.cylinders);
        if (pileMesh) {
          state.meshes.push(pileMesh);
        }
        state.elevationRange = computeDataElevationRange(state.meshes);
        state.meshes.forEach(refreshMeshColours);
        const rawLines = Array.isArray(state.scene.lines) ? state.scene.lines : [];
        rawLines.forEach(function (raw) {
          const line = createLine(raw);
          if (line) {
            state.lines.push(line);
          }
        });
        state.totalTriangles = state.meshes.reduce(function (total, mesh) {
          return total + Math.floor(mesh.indices.length / 3);
        }, 0);
        // Alternative existing-terrain meshes are never shown together. The
        // active-condition budget is recalculated in collectTriangles().
        state.renderStride = 1;
        refreshGrid();
        updateSceneUi();
        if (!state.meshes.length && !state.lines.length) {
          const warnings = Array.isArray(state.scene.warnings) ? state.scene.warnings : [];
          showEmpty(warnings.length ? warnings[0] : "No renderable design data is available.");
          requestRender();
          return true;
        }
        emptyState.classList.add("hidden");
        sceneHud.classList.remove("hidden");
        interactionHelp.classList.remove("hidden");
        axisGizmo.classList.remove("hidden");
        legend.classList.remove("hidden");
        fitView();
        updateLegend();
        requestRender();
        return true;
      } catch (error) {
        console.error("RED software 3D scene load failed", error);
        showEmpty("The software 3D scene could not be prepared: " + (error && error.message ? error.message : String(error)));
        return false;
      }
    }

    function showEmpty(message) {
      emptyMessage.textContent = String(message || "No scene is available.");
      emptyState.classList.remove("hidden");
      sceneHud.classList.add("hidden");
      interactionHelp.classList.add("hidden");
      axisGizmo.classList.add("hidden");
      legend.classList.add("hidden");
    }

    function updateSceneUi() {
      const scene = state.scene || {};
      const details = scene.scenario || {};
      const stats = scene.statistics || {};
      const comparison = scene.comparison || {};
      const terrainContext = scene.terrain_context || {};
      scenarioName.textContent = details.name || "Unnamed scenario";
      const parts = [];
      parts.push(formatInteger(stats.design_triangles || 0) + " design triangles");
      if (stats.context_triangles) {
        parts.push(formatInteger(stats.context_triangles) + " terrain-context triangles");
      }
      if (stats.comparison_triangles) {
        parts.push(formatInteger(stats.comparison_triangles) + " comparison triangles");
      }
      if (stats.imagery_triangles) {
        parts.push(formatInteger(stats.imagery_triangles) + " full-imagery triangles");
      }
      if (Number(comparison.coverage_percent) > 0) {
        parts.push(formatNumber(comparison.coverage_percent, 1) + "% comparison coverage");
      }
      if (stats.pile_count) {
        parts.push(formatInteger(stats.pile_count) + " piles");
      }
      sceneSummary.textContent = parts.join(" | ");
      const source = terrainContext.source
        ? " | terrain context: " + terrainContext.source
        : comparison.source && comparison.source !== "Unavailable"
          ? " | existing: " + comparison.source
          : "";
      sceneCrs.textContent = (details.crs || "Local projected coordinates") + " | revision " + (details.surface_revision || 0) + source + " | software renderer";
      const warnings = Array.isArray(scene.warnings) ? scene.warnings.slice() : [];
      warnings.unshift("WebGL is unavailable in this QGIS session; RED is using the CPU-based software 3D renderer.");
      if (state.renderStride > 1) {
        warnings.push("The software view is displaying approximately one in every " + state.renderStride + " triangles to remain responsive; engineering geometry is unchanged.");
      }
      warningList.textContent = warnings.join("\n");
      warningPanel.classList.toggle("hidden", warnings.length === 0);
    }

    function updateLegend() {
      let title = "Design elements";
      let items = [];
      if (state.imageryVisible && state.condition === "existing") {
        title = "Existing aerial imagery";
        items = [];
      } else if (state.colorMode === "elements") {
        const labels = ["Toe", "Batter", "Bench", "Crest control", "Crest platform", "Back batter", "Final tie-in", "Custom", "Unknown"];
        items = labels.map(function (label, index) { return [label, ELEMENT_COLOURS[index]]; });
      } else if (state.colorMode === "cut_fill") {
        title = "Cut / fill (design minus existing)";
        const stats = state.scene && state.scene.statistics ? state.scene.statistics : {};
        const tolerance = cutFillTolerance();
        items = [
          ["Cut to " + formatNumber(stats.maximum_cut || 0, 2) + " m", [0.90, 0.24, 0.15]],
          ["Neutral +/-" + formatNumber(tolerance, 2) + " m", [0.91, 0.91, 0.86]],
          ["Fill to " + formatNumber(stats.maximum_fill || 0, 2) + " m", [0.13, 0.46, 0.90]]
        ];
      } else if (state.colorMode === "elevation") {
        title = "Design elevation";
        const range = state.elevationRange || [0, 1];
        items = [
          [formatNumber(range[0] + originValue("z"), 2) + " m", [0.05, 0.34, 0.62]],
          [formatNumber((range[0] + range[1]) * 0.5 + originValue("z"), 2) + " m", [0.13, 0.71, 0.74]],
          [formatNumber(range[1] + originValue("z"), 2) + " m", [0.96, 0.87, 0.68]]
        ];
      } else if (state.colorMode === "slope") {
        title = "Surface slope";
        items = [["0-10 deg", [0.18, 0.62, 0.34]], ["10-25 deg", [0.80, 0.78, 0.25]], ["25-40 deg", [0.96, 0.52, 0.16]], [">40 deg", [0.71, 0.10, 0.14]]];
      }
      legendTitle.textContent = title;
      legendItems.textContent = "";
      items.forEach(function (item) {
        const row = document.createElement("span");
        row.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.background = colourCss(item[1]);
        const label = document.createElement("span");
        label.textContent = item[0];
        row.appendChild(swatch);
        row.appendChild(label);
        legendItems.appendChild(row);
      });
    }

    function originValue(axis) {
      const origin = state.scene && state.scene.origin ? state.scene.origin : {};
      const value = Number(origin[axis]);
      return Number.isFinite(value) ? value : 0;
    }

    function formatNumber(value, decimals) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(decimals == null ? 3 : decimals) : "n/a";
    }

    function formatInteger(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number).toLocaleString() : "0";
    }

    function cameraEye() {
      const camera = state.camera;
      const cp = Math.cos(camera.pitch);
      return [
        camera.target[0] + camera.distance * cp * Math.cos(camera.yaw),
        camera.target[1] + camera.distance * Math.sin(camera.pitch),
        camera.target[2] + camera.distance * cp * Math.sin(camera.yaw)
      ];
    }

    function updateMatrices() {
      const width = Math.max(canvas.width, 1);
      const height = Math.max(canvas.height, 1);
      const aspect = width / height;
      const eye = cameraEye();
      state.viewMatrix = mat4LookAt(eye, state.camera.target, [0, 1, 0]);
      if (state.projection === "orthographic") {
        const halfHeight = Math.max(state.camera.orthoScale, 0.01) * 0.5;
        const halfWidth = halfHeight * aspect;
        state.projectionMatrix = mat4Ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, -state.camera.far, state.camera.far);
      } else {
        state.projectionMatrix = mat4Perspective(45 * Math.PI / 180, aspect, state.camera.near, state.camera.far);
      }
      state.viewProjectionMatrix = mat4Multiply(state.projectionMatrix, state.viewMatrix);
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(Math.max(Number(window.devicePixelRatio) || 1, 1), 2);
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      state.deviceScale = scale;
    }

    function projectPoint(point) {
      const clip = transformVec4(state.viewProjectionMatrix, [point[0], point[1], point[2], 1]);
      if (!Number.isFinite(clip[3]) || clip[3] <= 1e-7) {
        return null;
      }
      const inverseW = 1 / clip[3];
      const ndcX = clip[0] * inverseW;
      const ndcY = clip[1] * inverseW;
      const ndcZ = clip[2] * inverseW;
      if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || !Number.isFinite(ndcZ)) {
        return null;
      }
      return {
        x: (ndcX * 0.5 + 0.5) * canvas.width,
        y: (1 - (ndcY * 0.5 + 0.5)) * canvas.height,
        depth: ndcZ,
        ndcX: ndcX,
        ndcY: ndcY
      };
    }

    function isExistingRole(role) {
      return role === "existing" || role === "existing_context" ||
        role === "existing_comparison" || role === "existing_imagery_full";
    }

    function roleVisible(mesh) {
      if (!mesh.visible) {
        return false;
      }
      if (mesh.role === "design") {
        if (state.condition === "existing") { return false; }
        return state.visibility.design;
      }
      if (isExistingRole(mesh.role)) {
        if (!state.visibility.existing) {
          return false;
        }
        if (mesh.role === "existing_imagery_full") {
          return state.imageryVisible && state.condition === "existing";
        }
        const fullImageryAvailable = state.meshes.some(function (item) {
          return item.role === "existing_imagery_full" && item.visible;
        });
        if (state.imageryVisible && state.condition === "existing" && fullImageryAvailable) {
          return false;
        }
        const effectiveDesignVisible = state.visibility.design && state.condition !== "existing";
        if (mesh.role === "existing_comparison" && !mesh.showWithDesign && effectiveDesignVisible) {
          return false;
        }
        return true;
      }
      if (mesh.role === "pile") {
        if (state.condition === "existing") { return false; }
        return state.visibility.piles;
      }
      if (state.condition === "existing") { return false; }
      return structureVisibility(mesh.layerGroup);
    }

    function meshOpacity(mesh) {
      let value = mesh.role === "design" ? mesh.opacity * state.designOpacity : mesh.opacity;
      if (isExistingRole(mesh.role)) {
        value *= state.existingOpacity;
      }
      if ((mesh.role === "existing" || mesh.role === "existing_comparison") && state.colorMode === "cut_fill") {
        value = Math.min(Number(value), 0.18);
      }
      return clamp(Number(value), 0, 1);
    }

    function averageVertexColour(mesh, vertices) {
      const result = [0, 0, 0];
      vertices.forEach(function (vertex) {
        result[0] += mesh.colours[vertex * 3];
        result[1] += mesh.colours[vertex * 3 + 1];
        result[2] += mesh.colours[vertex * 3 + 2];
      });
      return [result[0] / 3, result[1] / 3, result[2] / 3];
    }

    function triangleLighting(mesh, vertices) {
      const ia = vertices[0] * 3;
      const ib = vertices[1] * 3;
      const ic = vertices[2] * 3;
      const a = [mesh.positions[ia], mesh.positions[ia + 1], mesh.positions[ia + 2]];
      const b = [mesh.positions[ib], mesh.positions[ib + 1], mesh.positions[ib + 2]];
      const c = [mesh.positions[ic], mesh.positions[ic + 1], mesh.positions[ic + 2]];
      let normal = vec3Normalize(vec3Cross(vec3Subtract(b, a), vec3Subtract(c, a)));
      if (normal[1] < 0) {
        normal = vec3Scale(normal, -1);
      }
      const lights = lightingValues();
      const lightA = vec3Normalize(lights.primary);
      const lightB = vec3Normalize(lights.fill);
      const diffuse = Math.max(vec3Dot(normal, lightA), 0) * 0.58;
      const fill = Math.max(vec3Dot(normal, lightB), 0) * 0.17;
      return clamp(lights.ambient + diffuse + fill, 0.28, 1.15);
    }

    function collectTriangles() {
      const triangles = [];
      const visibleTriangles = state.meshes.filter(roleVisible).reduce(function (total, mesh) {
        return total + Math.floor(mesh.indices.length / 3);
      }, 0);
      const stride = Math.max(1, Math.ceil(visibleTriangles / SOFTWARE_TRIANGLE_BUDGET));
      state.renderStride = stride;
      state.meshes.forEach(function (mesh) {
        if (!roleVisible(mesh)) {
          return;
        }
        const opacity = meshOpacity(mesh);
        let triangleNumber = 0;
        for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
          if (triangleNumber % stride !== 0) {
            triangleNumber += 1;
            continue;
          }
          triangleNumber += 1;
          const vertices = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
          const projected = [];
          let outside = false;
          vertices.forEach(function (vertex) {
            const offset = vertex * 3;
            const point = projectPoint([mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]]);
            if (!point) {
              outside = true;
            }
            projected.push(point);
          });
          if (outside) {
            continue;
          }
          const minX = Math.min(projected[0].ndcX, projected[1].ndcX, projected[2].ndcX);
          const maxX = Math.max(projected[0].ndcX, projected[1].ndcX, projected[2].ndcX);
          const minY = Math.min(projected[0].ndcY, projected[1].ndcY, projected[2].ndcY);
          const maxY = Math.max(projected[0].ndcY, projected[1].ndcY, projected[2].ndcY);
          if (maxX < -1.25 || minX > 1.25 || maxY < -1.25 || minY > 1.25) {
            continue;
          }
          const colour = averageVertexColour(mesh, vertices);
          const lighting = mesh.role === "design" || isExistingRole(mesh.role)
            ? triangleLighting(mesh, vertices)
            : mesh.role === "pile"
              ? 1.0
              : 0.88;
          triangles.push({
            mesh: mesh,
            vertices: vertices,
            projected: projected,
            depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3,
            colour: [
              clamp(colour[0] * lighting, 0, 1),
              clamp(colour[1] * lighting, 0, 1),
              clamp(colour[2] * lighting, 0, 1)
            ],
            opacity: opacity
          });
        }
      });
      triangles.sort(function (a, b) { return b.depth - a.depth; });
      return triangles;
    }

    function drawGrid() {
      if (!state.grid || !state.visibility.grid) {
        return;
      }
      context.save();
      context.strokeStyle = "rgba(128,151,163,0.22)";
      context.lineWidth = Math.max(1, state.deviceScale * 0.75);
      context.beginPath();
      const positions = state.grid.positions;
      for (let index = 0; index + 5 < positions.length; index += 6) {
        const a = projectPoint([positions[index], positions[index + 1], positions[index + 2]]);
        const b = projectPoint([positions[index + 3], positions[index + 4], positions[index + 5]]);
        if (!a || !b) {
          continue;
        }
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.stroke();
      context.restore();
    }

    function drawTriangles(triangles) {
      const wireColour = "rgba(7,14,18,0.48)";
      triangles.forEach(function (triangle) {
        const points = triangle.projected;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        context.lineTo(points[1].x, points[1].y);
        context.lineTo(points[2].x, points[2].y);
        context.closePath();
        context.fillStyle = colourCss(triangle.colour, triangle.opacity);
        context.fill();
        if (state.wireframe) {
          context.strokeStyle = wireColour;
          context.lineWidth = Math.max(0.65, state.deviceScale * 0.55);
          context.stroke();
        }
      });
    }

    function drawLines() {
      if (state.condition === "existing") {
        return;
      }
      context.save();
      context.lineJoin = "round";
      context.lineCap = "round";
      state.lines.forEach(function (line) {
        if (!line.visible || !state.visibility[line.category]) {
          return;
        }
        const positions = line.positions;
        context.beginPath();
        let hasPoint = false;
        for (let index = 0; index + 2 < positions.length; index += 3) {
          const point = projectPoint([positions[index], positions[index + 1], positions[index + 2]]);
          if (!point) {
            hasPoint = false;
            continue;
          }
          if (!hasPoint) {
            context.moveTo(point.x, point.y);
            hasPoint = true;
          } else {
            context.lineTo(point.x, point.y);
          }
        }
        context.strokeStyle = colourCss(line.color, 1);
        context.lineWidth = Math.max(1.25, state.deviceScale * 1.2);
        context.stroke();
      });
      context.restore();
    }

    function render() {
      state.renderPending = false;
      resizeCanvas();
      updateMatrices();
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = environmentColour();
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid();
      drawTriangles(collectTriangles());
      drawLines();
      context.restore();
    }

    function requestRender() {
      if (!state.renderPending) {
        state.renderPending = true;
        window.requestAnimationFrame(render);
      }
    }

    function renderBounds() {
      if (!state.scene || !state.scene.bounds) {
        return { minimum: [-1, -1, -1], maximum: [1, 1, 1] };
      }
      const minimum = state.scene.bounds.minimum || [-1, -1, -1];
      const maximum = state.scene.bounds.maximum || [1, 1, 1];
      const corners = [];
      [Number(minimum[0]) || 0, Number(maximum[0]) || 0].forEach(function (x) {
        [Number(minimum[1]) || 0, Number(maximum[1]) || 0].forEach(function (y) {
          [Number(minimum[2]) || 0, Number(maximum[2]) || 0].forEach(function (z) {
            corners.push(dataToRenderPoint(x, y, z));
          });
        });
      });
      return {
        minimum: [
          Math.min.apply(null, corners.map(function (point) { return point[0]; })),
          Math.min.apply(null, corners.map(function (point) { return point[1]; })),
          Math.min.apply(null, corners.map(function (point) { return point[2]; }))
        ],
        maximum: [
          Math.max.apply(null, corners.map(function (point) { return point[0]; })),
          Math.max.apply(null, corners.map(function (point) { return point[1]; })),
          Math.max.apply(null, corners.map(function (point) { return point[2]; }))
        ]
      };
    }

    function fitView() {
      if (!state.scene) {
        return false;
      }
      const bounds = renderBounds();
      const centre = [
        (bounds.minimum[0] + bounds.maximum[0]) * 0.5,
        (bounds.minimum[1] + bounds.maximum[1]) * 0.5,
        (bounds.minimum[2] + bounds.maximum[2]) * 0.5
      ];
      const diagonal = vec3Length(vec3Subtract(bounds.maximum, bounds.minimum));
      const radius = Math.max(diagonal * 0.5, 1.0);
      state.camera.target = centre;
      state.camera.distance = radius / Math.sin(22.5 * Math.PI / 180) * 1.12;
      state.camera.orthoScale = radius * 2.35;
      state.camera.near = Math.max(radius / 10000, 0.001);
      state.camera.far = Math.max(radius * 30, 1000);
      requestRender();
      return true;
    }

    function topView() {
      if (!state.scene) {
        return false;
      }
      const bounds = renderBounds();
      const centre = [
        (bounds.minimum[0] + bounds.maximum[0]) * 0.5,
        (bounds.minimum[1] + bounds.maximum[1]) * 0.5,
        (bounds.minimum[2] + bounds.maximum[2]) * 0.5
      ];
      const width = Math.max(bounds.maximum[0] - bounds.minimum[0], 1);
      const depth = Math.max(bounds.maximum[2] - bounds.minimum[2], 1);
      state.camera.target = centre;
      state.camera.yaw = -Math.PI / 2;
      state.camera.pitch = Math.PI / 2 - 0.001;
      state.camera.distance = Math.max(width, depth) * 1.8;
      state.camera.orthoScale = Math.max(width, depth) * 1.15;
      requestRender();
      return true;
    }

    function cameraFrame() {
      const bounds = renderBounds();
      const centre = [
        (bounds.minimum[0] + bounds.maximum[0]) * 0.5,
        (bounds.minimum[1] + bounds.maximum[1]) * 0.5,
        (bounds.minimum[2] + bounds.maximum[2]) * 0.5
      ];
      const width = Math.max(bounds.maximum[0] - bounds.minimum[0], 1);
      const depth = Math.max(bounds.maximum[2] - bounds.minimum[2], 1);
      return { centre: centre, width: width, depth: depth, extent: Math.max(width, depth) };
    }

    function setCameraPreset(preset) {
      if (!state.scene) { return false; }
      const mode = String(preset || "aerial");
      const frame = cameraFrame();
      state.camera.target = frame.centre;
      state.camera.distance = frame.extent * 1.8;
      state.camera.orthoScale = frame.extent * 1.15;
      if (mode === "top") {
        state.camera.yaw = -Math.PI / 2;
        state.camera.pitch = Math.PI / 2 - 0.001;
      } else if (mode === "along") {
        state.camera.yaw = frame.width >= frame.depth ? Math.PI : -Math.PI / 2;
        state.camera.pitch = 0.20;
      } else if (mode === "across") {
        state.camera.yaw = frame.width >= frame.depth ? -Math.PI / 2 : Math.PI;
        state.camera.pitch = 0.20;
      } else {
        state.camera.yaw = -0.72;
        state.camera.pitch = 0.56;
        state.camera.distance = frame.extent * 1.65;
      }
      requestRender();
      return true;
    }

    function getCamera() {
      return {
        target: state.camera.target.slice(), yaw: state.camera.yaw,
        pitch: state.camera.pitch, distance: state.camera.distance,
        orthoScale: state.camera.orthoScale, near: state.camera.near, far: state.camera.far,
        projection: state.projection
      };
    }

    function setCamera(camera) {
      if (!camera || !Array.isArray(camera.target) || camera.target.length < 3) { return false; }
      const numeric = ["yaw", "pitch", "distance", "orthoScale", "near", "far"];
      if (numeric.some(function (key) { return !Number.isFinite(Number(camera[key])); })) { return false; }
      state.camera.target = camera.target.slice(0, 3).map(Number);
      numeric.forEach(function (key) { state.camera[key] = Number(camera[key]); });
      state.projection = String(camera.projection) === "orthographic" ? "orthographic" : "perspective";
      requestRender();
      return true;
    }

    function saveView() {
      state.savedCamera = {
        target: state.camera.target.slice(), yaw: state.camera.yaw,
        pitch: state.camera.pitch, distance: state.camera.distance,
        orthoScale: state.camera.orthoScale, near: state.camera.near, far: state.camera.far,
        projection: state.projection
      };
      return true;
    }

    function recallView() {
      if (!state.savedCamera) { return false; }
      const saved = state.savedCamera;
      state.camera.target = saved.target.slice();
      state.camera.yaw = saved.yaw;
      state.camera.pitch = saved.pitch;
      state.camera.distance = saved.distance;
      state.camera.orthoScale = saved.orthoScale;
      state.camera.near = saved.near;
      state.camera.far = saved.far;
      state.projection = saved.projection;
      requestRender();
      return true;
    }

    function setVerticalExaggeration(value) {
      const next = clamp(Number(value) || 1, 0.25, 20);
      if (Math.abs(next - state.verticalExaggeration) < 1e-9) {
        return true;
      }
      state.verticalExaggeration = next;
      state.meshes.forEach(refreshGeometry);
      state.lines.forEach(refreshLineGeometry);
      refreshGrid();
      updateLegend();
      fitView();
      return true;
    }

    function setColorMode(mode) {
      const normalized = String(mode || "elements");
      state.colorMode = ["elements", "cut_fill", "elevation", "slope"].indexOf(normalized) >= 0
        ? normalized
        : "elements";
      state.meshes.forEach(function (mesh) {
        if (mesh.role === "design") {
          refreshMeshColours(mesh);
        }
      });
      updateLegend();
      requestRender();
      return true;
    }

    function setVisibility(role, visible) {
      const key = String(role || "");
      if (Object.prototype.hasOwnProperty.call(state.visibility, key)) {
        state.visibility[key] = Boolean(visible);
        requestRender();
        return true;
      }
      return false;
    }

    function setLayerVisibility(identifier, visible) {
      const key = String(identifier || "");
      let changed = false;
      state.meshes.concat(state.lines).forEach(function (item) {
        if (String(item.id || "") === key) {
          item.visible = Boolean(visible);
          changed = true;
        }
      });
      if (changed) {
        requestRender();
      }
      return changed;
    }

    function getLayers() {
      return state.meshes.concat(state.lines).map(function (item) {
        return {
          id: String(item.id || ""),
          label: String(item.label || item.id || "Layer"),
          role: String(item.role || ""),
          category: String(item.category || ""),
          layer_group: String(item.layerGroup || ""),
          visible: item.visible !== false
        };
      });
    }

    function getLayerGroups() {
      return Object.assign({}, ((state.scene || {}).layer_groups || {}));
    }

    function setProjection(projection) {
      state.projection = String(projection) === "orthographic" ? "orthographic" : "perspective";
      requestRender();
      return true;
    }

    function setOpacity(role, value) {
      const key = String(role || "");
      const opacity = clamp(Number(value), 0.05, 1.0);
      if (key === "design") {
        state.designOpacity = opacity;
        requestRender();
        return true;
      }
      if (key === "existing") {
        state.existingOpacity = opacity;
        requestRender();
        return true;
      }
      let changed = false;
      state.meshes.forEach(function (mesh) {
        if (String(mesh.role || "") === key) {
          mesh.opacity = opacity;
          changed = true;
        }
      });
      if (changed) {
        requestRender();
      }
      return changed;
    }

    function setWireframe(enabled) {
      state.wireframe = Boolean(enabled);
      requestRender();
      return true;
    }

    function lightingValues() {
      if (state.lighting === "morning") {
        return { primary: [-0.72, 0.48, 0.28], fill: [0.45, 0.30, -0.62], ambient: 0.38 };
      }
      if (state.lighting === "midday") {
        return { primary: [0.18, 0.96, 0.24], fill: [-0.55, 0.32, -0.48], ambient: 0.40 };
      }
      if (state.lighting === "evening") {
        return { primary: [0.76, 0.36, -0.32], fill: [-0.35, 0.28, 0.62], ambient: 0.34 };
      }
      return { primary: [0.35, 0.86, 0.38], fill: [-0.65, 0.38, -0.55], ambient: 0.46 };
    }

    function environmentColour() {
      if (state.displayStyle === "natural") {
        return state.lighting === "evening" ? "rgb(51,41,43)" : "rgb(120,166,194)";
      }
      if (state.displayStyle === "construction") {
        return "rgb(92,110,120)";
      }
      return "rgb(14,22,28)";
    }

    function setDisplayStyle(style) {
      const value = String(style || "engineering");
      state.displayStyle = ["engineering", "natural", "construction"].indexOf(value) >= 0 ? value : "engineering";
      state.meshes.forEach(refreshMeshColours);
      document.body.dataset.displayStyle = state.displayStyle;
      updateLegend();
      requestRender();
      return true;
    }

    function setCondition(condition) {
      const value = String(condition || "engineering");
      state.condition = ["engineering", "existing", "construction", "early", "established"].indexOf(value) >= 0
        ? value : "engineering";
      if (state.condition !== "engineering") {
        state.colorMode = "elements";
      }
      if (state.condition === "engineering") {
        state.displayStyle = "engineering";
      } else if (state.condition === "construction") {
        state.displayStyle = "construction";
      } else {
        state.displayStyle = "natural";
      }
      state.meshes.forEach(refreshMeshColours);
      document.body.dataset.displayStyle = state.displayStyle;
      updateLegend();
      requestRender();
      return true;
    }

    function setImageryVisible(visible) {
      state.imageryVisible = Boolean(visible);
      state.meshes.forEach(refreshMeshColours);
      updateLegend();
      requestRender();
      return true;
    }

    function setLighting(lighting) {
      const value = String(lighting || "overcast");
      state.lighting = ["overcast", "morning", "midday", "evening"].indexOf(value) >= 0 ? value : "overcast";
      requestRender();
      return true;
    }

    function cameraBasis() {
      const eye = cameraEye();
      const forward = vec3Normalize(vec3Subtract(state.camera.target, eye));
      const right = vec3Normalize(vec3Cross(forward, [0, 1, 0]));
      const up = vec3Normalize(vec3Cross(right, forward));
      return { forward: forward, right: right, up: up };
    }

    function pointerDown(event) {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
        return;
      }
      if (typeof canvas.setPointerCapture === "function") {
        try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* host may reject capture */ }
      }
      state.pointer = {
        id: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      canvas.classList.add("dragging");
      event.preventDefault();
    }

    function pointerMove(event) {
      const pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) {
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (Math.abs(event.clientX - pointer.startX) + Math.abs(event.clientY - pointer.startY) > 4) {
        pointer.moved = true;
      }
      if (pointer.button === 0 && !event.shiftKey) {
        state.camera.yaw -= dx * 0.007;
        state.camera.pitch = clamp(state.camera.pitch + dy * 0.006, -Math.PI * 0.48, Math.PI * 0.48);
      } else {
        const basis = cameraBasis();
        const scale = state.projection === "orthographic"
          ? state.camera.orthoScale / Math.max(canvas.clientHeight, 1)
          : state.camera.distance * 0.0017;
        state.camera.target = vec3Add(
          state.camera.target,
          vec3Add(vec3Scale(basis.right, -dx * scale), vec3Scale(basis.up, dy * scale))
        );
      }
      requestRender();
      event.preventDefault();
    }

    function pointerUp(event) {
      const pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) {
        return;
      }
      if (!pointer.moved && pointer.button === 0) {
        pickAt(event.clientX, event.clientY);
      }
      state.pointer = null;
      canvas.classList.remove("dragging");
      if (typeof canvas.releasePointerCapture === "function") {
        try { canvas.releasePointerCapture(event.pointerId); } catch (_error) { /* already released */ }
      }
      event.preventDefault();
    }

    function wheel(event) {
      const factor = Math.exp(clamp(event.deltaY, -240, 240) * 0.0012);
      if (state.projection === "orthographic") {
        state.camera.orthoScale = clamp(state.camera.orthoScale * factor, 0.01, 1e9);
      } else {
        state.camera.distance = clamp(state.camera.distance * factor, 0.01, 1e9);
      }
      requestRender();
      event.preventDefault();
    }

    function screenRay(clientX, clientY) {
      resizeCanvas();
      updateMatrices();
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const y = 1 - ((clientY - rect.top) / Math.max(rect.height, 1)) * 2;
      const inverse = mat4Invert(state.viewProjectionMatrix);
      if (!inverse) {
        return null;
      }
      let near = transformVec4(inverse, [x, y, -1, 1]);
      let far = transformVec4(inverse, [x, y, 1, 1]);
      if (Math.abs(near[3]) < 1e-12 || Math.abs(far[3]) < 1e-12) {
        return null;
      }
      near = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
      far = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
      return { origin: near, direction: vec3Normalize(vec3Subtract(far, near)) };
    }

    function rayTriangle(origin, direction, a, b, c) {
      const epsilon = 1e-8;
      const edge1 = vec3Subtract(b, a);
      const edge2 = vec3Subtract(c, a);
      const p = vec3Cross(direction, edge2);
      const determinant = vec3Dot(edge1, p);
      if (Math.abs(determinant) < epsilon) {
        return null;
      }
      const inverse = 1 / determinant;
      const tVector = vec3Subtract(origin, a);
      const u = vec3Dot(tVector, p) * inverse;
      if (u < 0 || u > 1) {
        return null;
      }
      const q = vec3Cross(tVector, edge1);
      const v = vec3Dot(direction, q) * inverse;
      if (v < 0 || u + v > 1) {
        return null;
      }
      const distance = vec3Dot(edge2, q) * inverse;
      if (distance <= epsilon) {
        return null;
      }
      return { distance: distance, barycentric: [1 - u - v, u, v] };
    }

    function pickAt(clientX, clientY) {
      const candidates = state.meshes.filter(roleVisible);
      if (!candidates.length) {
        hideInspector();
        return false;
      }
      const ray = screenRay(clientX, clientY);
      if (!ray) {
        return false;
      }
      let best = null;
      candidates.forEach(function (mesh) {
        for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
          const vertexIndices = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
          const points = vertexIndices.map(function (vertexIndex) {
            const offset = vertexIndex * 3;
            return [mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]];
          });
          const hit = rayTriangle(ray.origin, ray.direction, points[0], points[1], points[2]);
          if (hit && (!best || hit.distance < best.distance)) {
            best = { mesh: mesh, distance: hit.distance, barycentric: hit.barycentric, vertexIndices: vertexIndices };
          }
        }
      });
      if (!best) {
        hideInspector();
        return false;
      }
      showInspector(best.mesh, best);
      return true;
    }

    function interpolateAttribute(values, indices, barycentric) {
      if (!Array.isArray(values)) {
        return null;
      }
      let result = 0;
      for (let index = 0; index < 3; index += 1) {
        const value = Number(values[indices[index]]);
        if (!Number.isFinite(value)) {
          return null;
        }
        result += value * barycentric[index];
      }
      return result;
    }

    function closestVertex(indices, barycentric) {
      let best = 0;
      for (let index = 1; index < 3; index += 1) {
        if (barycentric[index] > barycentric[best]) {
          best = index;
        }
      }
      return indices[best];
    }

    function showInspector(mesh, hit) {
      const vertexIndices = hit.vertexIndices;
      const barycentric = hit.barycentric;
      const localX = interpolateAttribute(
        vertexIndices.map(function (vertex) { return mesh.sourcePositions[vertex * 3]; }),
        [0, 1, 2],
        barycentric
      );
      const localY = interpolateAttribute(
        vertexIndices.map(function (vertex) { return mesh.sourcePositions[vertex * 3 + 1]; }),
        [0, 1, 2],
        barycentric
      );
      const localZ = interpolateAttribute(
        vertexIndices.map(function (vertex) { return mesh.sourcePositions[vertex * 3 + 2]; }),
        [0, 1, 2],
        barycentric
      );
      const delta = interpolateAttribute(mesh.delta, vertexIndices, barycentric);
      const existing = interpolateAttribute(mesh.existingZ, vertexIndices, barycentric);
      const chainage = interpolateAttribute(mesh.chainage, vertexIndices, barycentric);
      const offset = interpolateAttribute(mesh.offset, vertexIndices, barycentric);
      const nearest = closestVertex(vertexIndices, barycentric);
      const sectionIndex = mesh.section ? Number(mesh.section[nearest]) : -1;
      const sectionId = Number.isFinite(sectionIndex) && sectionIndex >= 0
        ? String(mesh.sectionIds[sectionIndex] || "")
        : "";
      const elementIndex = mesh.element ? Number(mesh.element[nearest]) : -1;
      const element = Number.isFinite(elementIndex) && elementIndex >= 0
        ? String(mesh.elementLabels[elementIndex] || "unknown")
        : "unknown";
      state.selectedSectionId = sectionId;
      const values = [
        ["Surface / object", mesh.label],
        ["Easting", formatNumber(localX + originValue("x"), 3) + " m"],
        ["Northing", formatNumber(localY + originValue("y"), 3) + " m"],
        [mesh.role === "design" ? "Design RL" : "Surface RL", formatNumber(localZ + originValue("z"), 3) + " m"],
        ["Existing RL", existing == null ? "n/a" : formatNumber(existing, 3) + " m"],
        ["Earthworks", earthworksLabel(delta)],
        ["Design - existing", delta == null ? "n/a" : signedNumber(delta, 3) + " m"],
        ["Chainage", chainage == null ? "n/a" : formatChainage(chainage)],
        ["Offset", offset == null ? "n/a" : signedNumber(offset, 3) + " m"],
        ["Element", humanise(element)],
        ["Section", sectionId || "n/a"]
      ];
      inspectorValues.textContent = "";
      values.forEach(function (row) {
        const term = document.createElement("dt");
        term.textContent = row[0];
        const description = document.createElement("dd");
        description.textContent = row[1];
        inspectorValues.appendChild(term);
        inspectorValues.appendChild(description);
      });
      inspector.classList.remove("hidden");
      openSection.classList.toggle("hidden", !sectionId);
    }

    function signedNumber(value, decimals) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return "n/a";
      }
      return (number > 0 ? "+" : "") + number.toFixed(decimals == null ? 3 : decimals);
    }

    function formatChainage(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return "n/a";
      }
      const kilometres = Math.floor(Math.abs(number) / 1000);
      const metres = Math.abs(number) - kilometres * 1000;
      const sign = number < 0 ? "-" : "";
      return sign + kilometres + "+" + metres.toFixed(3).padStart(7, "0");
    }

    function humanise(value) {
      return String(value || "unknown")
        .replace(/_/g, " ")
        .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
    }

    function hideInspector() {
      state.selectedSectionId = "";
      inspector.classList.add("hidden");
      openSection.classList.add("hidden");
    }

    function openSelectedSection() {
      if (!state.selectedSectionId) {
        return;
      }
      const bridge = state.bridge;
      if (bridge && typeof bridge.selectSection === "function") {
        bridge.selectSection(state.selectedSectionId);
      }
    }

    function initialiseWebChannel() {
      if (typeof QWebChannel === "undefined" || !window.qt || !window.qt.webChannelTransport) {
        return;
      }
      try {
        new QWebChannel(window.qt.webChannelTransport, function (channel) {
          state.bridge = channel.objects.red3dBridge || channel.objects.bridge || null;
        });
      } catch (error) {
        console.warn("RED 3D web channel could not initialise", error);
      }
    }

    canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", function () { fitView(); });
    inspectorClose.addEventListener("click", hideInspector);
    openSection.addEventListener("click", openSelectedSection);
    window.addEventListener("resize", requestRender);
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideInspector();
      } else if (event.key.toLowerCase() === "f") {
        fitView();
      } else if (event.key.toLowerCase() === "t") {
        topView();
      }
    });

    initialiseWebChannel();
    requestRender();

    return {
      loadScene: loadScene,
      setVisibility: setVisibility,
      setLayerVisibility: setLayerVisibility,
      setColorMode: setColorMode,
      setVerticalExaggeration: setVerticalExaggeration,
      setProjection: setProjection,
      setOpacity: setOpacity,
      setDisplayStyle: setDisplayStyle,
      setLighting: setLighting,
      setCondition: setCondition,
      setRenderPriority: function () { requestRender(); return true; },
      setImageryVisible: setImageryVisible,
      setCameraPreset: setCameraPreset,
      getCamera: getCamera,
      setCamera: setCamera,
      saveView: saveView,
      recallView: recallView,
      setWireframe: setWireframe,
      fitView: fitView,
      topView: topView,
      getLayers: getLayers,
      getLayerGroups: getLayerGroups,
      getState: function () {
        return {
          ready: true,
          webgl: false,
          backend: "canvas2d",
          loaded: Boolean(state.scene),
          meshCount: state.meshes.length,
          lineCount: state.lines.length,
          triangleCount: state.totalTriangles,
          renderStride: state.renderStride,
          colorMode: state.colorMode,
          verticalExaggeration: state.verticalExaggeration,
          projection: state.projection,
          displayStyle: state.displayStyle,
          lighting: state.lighting,
          condition: state.condition,
          imageryVisible: state.imageryVisible,
          visibility: Object.assign({}, state.visibility)
        };
      }
    };
  }

  window.RED3DCanvas2D = {
    create: createSoftwareRenderer
  };
}());
