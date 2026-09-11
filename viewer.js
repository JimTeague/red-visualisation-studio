/* RED HTML/WebGL 3D Review
 *
 * Dependency-free renderer for the local scene payload produced by
 * core.design_3d. The engineering model stays in Python; this file only
 * displays and inspects immutable scene data.
 */
(function () {
  "use strict";

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

  const webglOptions = {
    alpha: false,
    antialias: true,
    depth: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  };
  const gl = canvas.getContext("webgl", webglOptions) ||
    canvas.getContext("experimental-webgl", webglOptions);

  const ELEMENT_COLOURS = [
    [0.00, 0.76, 0.93], // toe
    [0.31, 0.67, 0.34], // batter
    [0.95, 0.77, 0.20], // bench
    [0.94, 0.29, 0.38], // crest control
    [0.69, 0.46, 0.84], // crest platform
    [0.93, 0.52, 0.20], // back batter
    [0.12, 0.78, 0.58], // final tie-in
    [0.53, 0.69, 0.76], // custom
    [0.66, 0.70, 0.73]  // unknown
  ];

  const state = {
    scene: null,
    meshes: [],
    lines: [],
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
    renderPriority: "realistic",
    imageryVisible: false,
    imageryBrightness: 1.0,
    imagerySaturation: 1.0,
    imageryContrast: 1.05,
    rockMaterial: "natural",
    timberMaterial: "natural",
    materialVariation: 0.35,
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
    contextLost: false,
    pointer: null,
    exportWidth: 0,
    exportHeight: 0
  };

  if (!gl) {
    if (window.RED3DCanvas2D && typeof window.RED3DCanvas2D.create === "function") {
      window.RED3D = window.RED3DCanvas2D.create();
    } else {
      showEmpty(
        "WebGL is unavailable and the RED software renderer could not be loaded."
      );
      window.RED3D = createUnavailableApi();
    }
    return;
  }

  canvas.dataset.renderer = "webgl";

  const uintIndexExtension = gl.getExtension("OES_element_index_uint");
  const anisotropyExtension = gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("MOZ_EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  const meshProgram = createProgram(
    gl,
    [
      "attribute vec3 a_position;",
      "attribute vec3 a_normal;",
      "attribute vec3 a_color;",
      "attribute vec2 a_texCoord;",
      "uniform mat4 u_viewProjection;",
      "varying vec3 v_normal;",
      "varying vec3 v_color;",
      "varying vec2 v_texCoord;",
      "varying vec3 v_position;",
      "void main(void) {",
      "  gl_Position = u_viewProjection * vec4(a_position, 1.0);",
      "  v_normal = a_normal;",
      "  v_color = a_color;",
      "  v_texCoord = a_texCoord;",
      "  v_position = a_position;",
      "}"
    ].join("\n"),
    [
      "precision mediump float;",
      "varying vec3 v_normal;",
      "varying vec3 v_color;",
      "varying vec2 v_texCoord;",
      "varying vec3 v_position;",
      "uniform float u_opacity;",
      "uniform float u_unlit;",
      "uniform vec3 u_lightA;",
      "uniform vec3 u_lightB;",
      "uniform float u_ambient;",
      "uniform float u_useTexture;",
      "uniform sampler2D u_texture;",
      "uniform float u_textureBrightness;",
      "uniform float u_textureSaturation;",
      "uniform float u_textureContrast;",
      "uniform float u_materialKind;",
      "uniform float u_materialVariation;",
      "uniform float u_time;",
      "float redHash(vec3 p) {",
      "  return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453);",
      "}",
      "void main(void) {",
      "  vec3 normal = normalize(v_normal);",
      "  float diffuse = max(dot(normal, normalize(u_lightA)), 0.0) * 0.58;",
      "  float fill = max(dot(normal, normalize(u_lightB)), 0.0) * 0.17;",
      "  float lighting = mix(u_ambient + diffuse + fill, 1.0, u_unlit);",
      "  vec3 tex = texture2D(u_texture, v_texCoord).rgb;",
      "  float grey = dot(tex, vec3(0.299, 0.587, 0.114));",
      "  tex = mix(vec3(grey), tex, u_textureSaturation);",
      "  tex = (tex - vec3(0.5)) * u_textureContrast + vec3(0.5);",
      "  tex *= u_textureBrightness;",
      "  tex = clamp(tex, 0.0, 1.0);",
      "  vec3 base = mix(v_color, tex, clamp(u_useTexture, 0.0, 1.0));",
      "  if (u_materialKind > 0.5 && u_materialKind < 1.5) {",
      "    float coarse = redHash(floor(v_position * 1.8));",
      "    float fine = redHash(floor(v_position * 7.0 + vec3(2.0,5.0,9.0)));",
      "    float rockTone = (coarse - 0.5) * 0.30 + (fine - 0.5) * 0.10;",
      "    base *= 1.0 + rockTone * u_materialVariation;",
      "    lighting *= 0.92 + fine * 0.11;",
      "  } else if (u_materialKind > 1.5 && u_materialKind < 2.5) {",
      "    float grain = sin((v_position.x + v_position.z) * 18.0 + v_position.y * 3.0);",
      "    float knot = redHash(floor(v_position * 3.5));",
      "    base *= 0.91 + 0.11 * grain * u_materialVariation + 0.12 * knot * u_materialVariation;",
      "  } else if (u_materialKind > 2.5 && u_materialKind < 3.5) {",
      "    float ripple = sin(v_position.x * 0.18 + u_time * 0.65) + cos(v_position.z * 0.15 - u_time * 0.52);",
      "    float sheen = pow(max(dot(normal, normalize(vec3(0.25, 1.0, 0.35))), 0.0), 10.0);",
      "    base *= 0.92 + ripple * 0.025;",
      "    base += vec3(0.08,0.12,0.14) * sheen;",
      "    lighting = mix(lighting, 0.88 + sheen * 0.35, 0.55);",
      "  } else if (u_materialKind > 3.5) {",
      "    float leaf = redHash(floor(v_position * 6.0));",
      "    float heightTone = clamp(v_position.y * 0.035, 0.0, 0.18);",
      "    base *= 0.86 + leaf * 0.24 + heightTone;",
      "    lighting = mix(lighting, 0.82 + leaf * 0.18, 0.30);",
      "  }",
      "  gl_FragColor = vec4(clamp(base * lighting, 0.0, 1.0), u_opacity);",
      "}"
    ].join("\n")
  );

  const lineProgram = createProgram(
    gl,
    [
      "attribute vec3 a_position;",
      "uniform mat4 u_viewProjection;",
      "void main(void) {",
      "  gl_Position = u_viewProjection * vec4(a_position, 1.0);",
      "}"
    ].join("\n"),
    [
      "precision mediump float;",
      "uniform vec4 u_color;",
      "void main(void) {",
      "  gl_FragColor = u_color;",
      "}"
    ].join("\n")
  );

  const meshLocations = {
    position: gl.getAttribLocation(meshProgram, "a_position"),
    normal: gl.getAttribLocation(meshProgram, "a_normal"),
    color: gl.getAttribLocation(meshProgram, "a_color"),
    texCoord: gl.getAttribLocation(meshProgram, "a_texCoord"),
    viewProjection: gl.getUniformLocation(meshProgram, "u_viewProjection"),
    opacity: gl.getUniformLocation(meshProgram, "u_opacity"),
    unlit: gl.getUniformLocation(meshProgram, "u_unlit"),
    lightA: gl.getUniformLocation(meshProgram, "u_lightA"),
    lightB: gl.getUniformLocation(meshProgram, "u_lightB"),
    ambient: gl.getUniformLocation(meshProgram, "u_ambient"),
    useTexture: gl.getUniformLocation(meshProgram, "u_useTexture"),
    texture: gl.getUniformLocation(meshProgram, "u_texture"),
    textureBrightness: gl.getUniformLocation(meshProgram, "u_textureBrightness"),
    textureSaturation: gl.getUniformLocation(meshProgram, "u_textureSaturation"),
    textureContrast: gl.getUniformLocation(meshProgram, "u_textureContrast"),
    materialKind: gl.getUniformLocation(meshProgram, "u_materialKind"),
    materialVariation: gl.getUniformLocation(meshProgram, "u_materialVariation"),
    time: gl.getUniformLocation(meshProgram, "u_time")
  };

  const lineLocations = {
    position: gl.getAttribLocation(lineProgram, "a_position"),
    viewProjection: gl.getUniformLocation(lineProgram, "u_viewProjection"),
    color: gl.getUniformLocation(lineProgram, "u_color")
  };

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  // Engineering surfaces and imported structure polygons can use either
  // winding convention. Render both faces so valid terrain is never hidden.
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.055, 0.086, 0.11, 1.0);

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
      setImageryAdjustments: noop,
      setMaterialOptions: noop,
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
      getState: function () { return { ready: false, webgl: false }; }
    };
  }

  function createShader(context, type, source) {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      const message = context.getShaderInfoLog(shader) || "Unknown shader error";
      context.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(context, vertexSource, fragmentSource) {
    const vertexShader = createShader(context, context.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fragmentSource);
    const program = context.createProgram();
    context.attachShader(program, vertexShader);
    context.attachShader(program, fragmentShader);
    context.linkProgram(program);
    context.deleteShader(vertexShader);
    context.deleteShader(fragmentShader);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      const message = context.getProgramInfoLog(program) || "Unknown program link error";
      context.deleteProgram(program);
      throw new Error(message);
    }
    return program;
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
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
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

  function colourCss(colour) {
    const values = colour.map(function (value) {
      return Math.round(clamp(value, 0, 1) * 255);
    });
    return "rgb(" + values.join(",") + ")";
  }

  function createBuffer(data, target, usage) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage || gl.STATIC_DRAW);
    return buffer;
  }

  function deleteRenderable(renderable) {
    ["positionBuffer", "normalBuffer", "colorBuffer", "indexBuffer", "wireIndexBuffer", "texCoordBuffer"].forEach(function (name) {
      if (renderable && renderable[name]) {
        gl.deleteBuffer(renderable[name]);
      }
    });
    if (renderable && renderable.texture && renderable.texture !== fallbackTexture) {
      gl.deleteTexture(renderable.texture);
    }
  }


  function createSolidTexture(rgba) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba)
    );
    return texture;
  }

  const fallbackTexture = createSolidTexture([255, 255, 255, 255]);

  function resolveTextureUrl(path) {
    const raw = String(path || "").trim();
    if (!raw) {
      return null;
    }
    const candidates = [raw];
    if (!/^([a-z]+:)?\/\//i.test(raw) && raw.charAt(0) !== "/" && raw.indexOf("data:") !== 0) {
      candidates.push("../" + raw.replace(/^\.\//, ""));
    }
    return candidates;
  }

  function loadTextureFromCandidates(candidates, callback, index) {
    const list = Array.isArray(candidates) ? candidates : [];
    const pointer = Number(index) || 0;
    if (pointer >= list.length) {
      callback(null);
      return;
    }
    const image = new Image();
    image.onload = function () {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (anisotropyExtension) {
        const maxAnisotropy = gl.getParameter(anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
        gl.texParameterf(gl.TEXTURE_2D, anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(maxAnisotropy, 8));
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      callback(texture);
      requestRender();
    };
    image.onerror = function () {
      loadTextureFromCandidates(list, callback, pointer + 1);
    };
    image.src = list[pointer];
  }

  function layerGroupForRole(role) {
    const value = String(role || "");
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

  function buildTextureCoordinates(sourcePositions) {
    const texture = ((state.scene || {}).imagery || {}).texture || null;
    if (!texture || !texture.bounds || !state.scene || !state.scene.origin) {
      return null;
    }
    const bounds = texture.bounds;
    const xmin = Number(bounds.xmin);
    const ymin = Number(bounds.ymin);
    const xmax = Number(bounds.xmax);
    const ymax = Number(bounds.ymax);
    const origin = state.scene.origin || {};
    const originX = Number(origin.x) || 0;
    const originY = Number(origin.y) || 0;
    const width = xmax - xmin;
    const height = ymax - ymin;
    if (!(width > 0) || !(height > 0)) {
      return null;
    }
    const texCoords = [];
    for (let index = 0; index + 2 < sourcePositions.length; index += 3) {
      const x = originX + (Number(sourcePositions[index]) || 0);
      const y = originY + (Number(sourcePositions[index + 1]) || 0);
      texCoords.push((x - xmin) / width, (ymax - y) / height);
    }
    return new Float32Array(texCoords);
  }

  function clearSceneResources() {
    state.meshes.forEach(deleteRenderable);
    state.lines.forEach(function (line) {
      if (line.positionBuffer) {
        gl.deleteBuffer(line.positionBuffer);
      }
    });
    if (state.grid && state.grid.positionBuffer) {
      gl.deleteBuffer(state.grid.positionBuffer);
    }
    state.meshes = [];
    state.lines = [];
    state.grid = null;
  }

  function dataToRenderPoint(x, y, z) {
    return [x, z * state.verticalExaggeration, -y];
  }

  function convertPositions(source) {
    const output = new Float32Array(source.length);
    for (let index = 0; index + 2 < source.length; index += 3) {
      output[index] = Number(source[index]) || 0;
      output[index + 1] = (Number(source[index + 2]) || 0) * state.verticalExaggeration;
      output[index + 2] = -(Number(source[index + 1]) || 0);
    }
    return output;
  }

  function buildNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const ia = indices[index] * 3;
      const ib = indices[index + 1] * 3;
      const ic = indices[index + 2] * 3;
      const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
      const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
      const c = [positions[ic], positions[ic + 1], positions[ic + 2]];
      const normal = vec3Cross(vec3Subtract(b, a), vec3Subtract(c, a));
      for (const vertexIndex of [ia, ib, ic]) {
        normals[vertexIndex] += normal[0];
        normals[vertexIndex + 1] += normal[1];
        normals[vertexIndex + 2] += normal[2];
      }
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

  function buildWireIndices(indices) {
    const unique = new Set();
    const values = [];
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const triangle = [indices[index], indices[index + 1], indices[index + 2]];
      for (const pair of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
        const low = Math.min(pair[0], pair[1]);
        const high = Math.max(pair[0], pair[1]);
        const key = low + ":" + high;
        if (!unique.has(key)) {
          unique.add(key);
          values.push(low, high);
        }
      }
    }
    return values;
  }

  function createIndexData(values) {
    let maximum = 0;
    for (let index = 0; index < values.length; index += 1) {
      maximum = Math.max(maximum, Number(values[index]) || 0);
    }
    if (maximum <= 65535) {
      return { data: new Uint16Array(values), type: gl.UNSIGNED_SHORT };
    }
    if (uintIndexExtension) {
      return { data: new Uint32Array(values), type: gl.UNSIGNED_INT };
    }
    return null;
  }

  function computeDataElevationRange(meshes) {
    let minimum = Infinity;
    let maximum = -Infinity;
    meshes.forEach(function (mesh) {
      if (mesh.role !== "design") {
        return;
      }
      const positions = mesh.sourcePositions || [];
      for (let index = 2; index < positions.length; index += 3) {
        const value = Number(positions[index]);
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
      const tolerance = cutFillTolerance();
      const maximum = Math.max(
        Math.abs(Number(state.scene.statistics.minimum_delta) || 0),
        Math.abs(Number(state.scene.statistics.maximum_delta) || 0),
        tolerance + 0.01
      );
      const magnitude = clamp(
        (Math.abs(raw) - tolerance) / Math.max(maximum - tolerance, 0.01),
        0,
        1
      );
      const neutral = [0.91, 0.91, 0.86];
      return raw < -tolerance
        ? mixColour(neutral, [0.90, 0.24, 0.15], magnitude)
        : raw > tolerance
          ? mixColour(neutral, [0.13, 0.46, 0.90], magnitude)
          : neutral;
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

  function materialNoise(mesh, vertexIndex) {
    const i = vertexIndex * 3;
    const x = Number(mesh.sourcePositions[i]) || 0;
    const y = Number(mesh.sourcePositions[i + 1]) || 0;
    const z = Number(mesh.sourcePositions[i + 2]) || 0;
    const seed = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + String(mesh.id || "").length * 11.13) * 43758.5453;
    return seed - Math.floor(seed);
  }

  function materialBase(mesh) {
    if (mesh.layerGroup === "rock") {
      if (state.rockMaterial === "fresh") { return [0.50, 0.49, 0.46]; }
      if (state.rockMaterial === "weathered") { return [0.40, 0.39, 0.34]; }
      return [0.44, 0.43, 0.39];
    }
    if (mesh.layerGroup === "large_wood" || mesh.role === "pile") {
      if (String(mesh.role || "").indexOf("rootball") >= 0) {
        if (state.timberMaterial === "fresh") { return [0.40, 0.25, 0.12]; }
        if (state.timberMaterial === "weathered") { return [0.27, 0.23, 0.18]; }
        return [0.31, 0.19, 0.08];
      }
      if (state.timberMaterial === "fresh") { return [0.49, 0.31, 0.14]; }
      if (state.timberMaterial === "weathered") { return [0.34, 0.29, 0.23]; }
      return [0.39, 0.24, 0.10];
    }
    if (mesh.role === "vegetation") { return [0.26, 0.46, 0.22]; }
    return null;
  }

  function refreshMeshColours(mesh) {
    const vertexCount = mesh.sourcePositions.length / 3;
    const colours = new Float32Array(vertexCount * 3);
    let base = parseColour(mesh.baseColor, [0.7, 0.72, 0.74]);
    if (state.displayStyle !== "engineering") {
      if (isExistingRole(mesh.role)) {
        base = state.displayStyle === "natural" ? [0.34, 0.45, 0.27] : [0.49, 0.43, 0.32];
      } else if (mesh.role === "pile") {
        base = [0.42, 0.25, 0.12];
      } else if (mesh.layerGroup === "large_wood") {
        base = state.displayStyle === "natural" ? [0.34, 0.20, 0.09] : [0.47, 0.29, 0.13];
      } else if (mesh.layerGroup === "rock" || /rock|scour|filter/i.test(mesh.id + " " + mesh.label)) {
        base = state.displayStyle === "natural" ? [0.42, 0.41, 0.37] : [0.53, 0.50, 0.44];
      } else if (mesh.role === "water") {
        base = parseColour(mesh.baseColor, [0.20, 0.55, 0.72]);
      } else if (mesh.role === "vegetation") {
        base = [0.27, 0.48, 0.22];
      }
    }
    const material = materialBase(mesh);
    if (material) { base = material; }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const imageryIndex = vertex * 3;
      const useImagery = state.imageryVisible && isExistingRole(mesh.role) &&
        mesh.imageryValid && Number(mesh.imageryValid[vertex]) > 0 &&
        mesh.imageryColors && mesh.imageryColors.length >= imageryIndex + 3;
      let colour = useImagery
        ? [mesh.imageryColors[imageryIndex], mesh.imageryColors[imageryIndex + 1], mesh.imageryColors[imageryIndex + 2]]
        : mesh.role === "design" ? designVertexColour(mesh, vertex) : base.slice();
      if (material && !useImagery) {
        const amount = (materialNoise(mesh, vertex) - 0.5) * 0.30 * state.materialVariation;
        colour = colour.map(function (value) { return clamp(value + amount, 0, 1); });
      }
      colours[vertex * 3] = colour[0];
      colours[vertex * 3 + 1] = colour[1];
      colours[vertex * 3 + 2] = colour[2];
    }
    mesh.colours = colours;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.DYNAMIC_DRAW);
  }

  function refreshGeometry(mesh) {
    mesh.positions = convertPositions(mesh.sourcePositions);
    mesh.normals = buildNormals(mesh.positions, mesh.indices);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
    refreshMeshColours(mesh);
  }

  function createMesh(raw, extra) {
    const sourcePositions = Array.isArray(raw.positions) ? raw.positions.map(Number) : [];
    const rawIndices = Array.isArray(raw.indices) ? raw.indices.map(Number) : [];
    if (sourcePositions.length < 9 || rawIndices.length < 3) {
      return null;
    }
    const indexData = createIndexData(rawIndices);
    if (!indexData) {
      return null;
    }
    const wireValues = buildWireIndices(rawIndices);
    const wireData = createIndexData(wireValues);
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
      indices: rawIndices,
      indexCount: indexData.data.length,
      indexType: indexData.type,
      wireIndexCount: wireData ? wireData.data.length : 0,
      wireIndexType: wireData ? wireData.type : gl.UNSIGNED_SHORT,
      delta: Array.isArray(raw.delta) ? raw.delta : null,
      existingZ: Array.isArray(raw.existing_z) ? raw.existing_z : null,
      chainage: Array.isArray(raw.chainage) ? raw.chainage : null,
      offset: Array.isArray(raw.offset) ? raw.offset : null,
      section: Array.isArray(raw.section) ? raw.section : null,
      sectionIds: Array.isArray(raw.section_ids) ? raw.section_ids.map(String) : [],
      element: Array.isArray(raw.element) ? raw.element : null,
      elementLabels: Array.isArray(raw.element_labels) ? raw.element_labels.map(String) : [],
      imageryColors: Array.isArray(raw.imagery_colors) ? raw.imagery_colors.map(Number) : null,
      imageryValid: Array.isArray(raw.imagery_valid) ? raw.imagery_valid.map(Number) : null,
      positionBuffer: gl.createBuffer(),
      normalBuffer: gl.createBuffer(),
      colorBuffer: gl.createBuffer(),
      indexBuffer: createBuffer(indexData.data, gl.ELEMENT_ARRAY_BUFFER),
      wireIndexBuffer: wireData ? createBuffer(wireData.data, gl.ELEMENT_ARRAY_BUFFER) : null
    }, extra || {});
    if (!Number.isFinite(mesh.opacity)) {
      mesh.opacity = 1.0;
    }
    mesh.useTexture = Boolean(
      (mesh.role === "existing_imagery_full" || mesh.role === "design") &&
      state.scene && state.scene.imagery && state.scene.imagery.texture
    );
    mesh.texture = fallbackTexture;
    mesh.texCoords = mesh.useTexture ? buildTextureCoordinates(sourcePositions) : null;
    if (mesh.texCoords) {
      mesh.texCoordBuffer = createBuffer(mesh.texCoords, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
      const texturePath = String((((state.scene || {}).imagery || {}).texture || {}).path || "");
      const candidates = resolveTextureUrl(texturePath);
      if (candidates) {
        loadTextureFromCandidates(candidates, function (texture) {
          if (texture) {
            if (mesh.texture && mesh.texture !== fallbackTexture) {
              gl.deleteTexture(mesh.texture);
            }
            mesh.texture = texture;
          }
        }, 0);
      }
    }
    refreshGeometry(mesh);
    return mesh;
  }

  function buildPileMesh(cylinders) {
    const positions = [];
    const indices = [];
    const sides = 16;
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
    const positions = [];
    sourcePoints.forEach(function (point) {
      if (!Array.isArray(point) || point.length < 3) {
        return;
      }
      const converted = dataToRenderPoint(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
      positions.push(converted[0], converted[1], converted[2]);
    });
    if (positions.length < 6) {
      return null;
    }
    const role = String(raw.role || "breakline");
    const structure = role === "pile_field_alignments" || role === "pile_scour" || role === "pile_scour_protection" || role === "structure_outline";
    return {
      id: String(raw.id || "line"),
      label: String(raw.label || raw.id || "Line"),
      role: role,
      category: structure ? "structures" : "breaklines",
      sourcePoints: sourcePoints,
      positions: new Float32Array(positions),
      color: parseColour(raw.color, [0.95, 0.95, 0.95]),
      visible: raw.visible !== false,
      positionBuffer: createBuffer(new Float32Array(positions), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
      count: positions.length / 3
    };
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
    line.positions = new Float32Array(positions);
    line.count = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, line.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, line.positions, gl.DYNAMIC_DRAW);
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
    return {
      positions: new Float32Array(positions),
      positionBuffer: createBuffer(new Float32Array(positions), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
      count: positions.length / 3,
      spacing: spacing
    };
  }

  function refreshGrid() {
    if (state.grid && state.grid.positionBuffer) {
      gl.deleteBuffer(state.grid.positionBuffer);
    }
    state.grid = state.scene ? createGrid(state.scene.bounds) : null;
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
      const pileMesh = buildPileMesh(Array.isArray(state.scene.cylinders) ? state.scene.cylinders : []);
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
      console.error("RED 3D scene load failed", error);
      showEmpty("The 3D scene could not be prepared: " + (error && error.message ? error.message : String(error)));
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
    sceneCrs.textContent = (details.crs || "Local projected coordinates") + " | revision " + (details.surface_revision || 0) + source;
    const warnings = Array.isArray(scene.warnings) ? scene.warnings : [];
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
    const width = Math.max(state.exportWidth || canvas.clientWidth, 1);
    const height = Math.max(state.exportHeight || canvas.clientHeight, 1);
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
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = state.exportWidth > 0 ? Math.max(1, Math.floor(state.exportWidth)) : Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = state.exportHeight > 0 ? Math.max(1, Math.floor(state.exportHeight)) : Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
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
        return state.imageryVisible;
      }
      const fullImageryAvailable = state.meshes.some(function (item) {
        return item.role === "existing_imagery_full" && item.visible;
      });
      if (state.imageryVisible && fullImageryAvailable && mesh.role === "existing_context") {
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
    if (mesh.role === "design") {
      return state.designOpacity;
    }
    let value = Number.isFinite(mesh.opacity) ? mesh.opacity : 1.0;
    const proposedStructure = mesh.role === "pile" || mesh.layerGroup === "rock" || mesh.layerGroup === "large_wood" || mesh.role === "vegetation";
    if (proposedStructure) {
      value *= state.designOpacity;
    }
    if (isExistingRole(mesh.role)) {
      value *= state.existingOpacity;
    }
    if ((mesh.role === "existing" || mesh.role === "existing_comparison") && state.colorMode === "cut_fill") {
      return Math.min(value, 0.18);
    }
    return value;
  }

  function bindMeshAttributes(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(meshLocations.position);
    gl.vertexAttribPointer(meshLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(meshLocations.normal);
    gl.vertexAttribPointer(meshLocations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.enableVertexAttribArray(meshLocations.color);
    gl.vertexAttribPointer(meshLocations.color, 3, gl.FLOAT, false, 0, 0);
    if (meshLocations.texCoord >= 0) {
      if (mesh.texCoordBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.texCoordBuffer);
        gl.enableVertexAttribArray(meshLocations.texCoord);
        gl.vertexAttribPointer(meshLocations.texCoord, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(meshLocations.texCoord);
        gl.vertexAttrib2f(meshLocations.texCoord, 0.0, 0.0);
      }
    }
  }

  function materialKind(mesh) {
    if (mesh.role === "vegetation") { return 4.0; }
    if (mesh.role === "water") { return 3.0; }
    if (mesh.layerGroup === "large_wood" || mesh.role === "pile") { return 2.0; }
    if (mesh.layerGroup === "rock" || /rock|scour|filter/i.test((mesh.id || "") + " " + (mesh.label || ""))) { return 1.0; }
    return 0.0;
  }

  function drawMesh(mesh, transparentPass) {
    if (!roleVisible(mesh)) {
      return;
    }
    const opacity = meshOpacity(mesh);
    const transparent = opacity < 0.995;
    if (transparent !== transparentPass) {
      return;
    }
    bindMeshAttributes(mesh);
    gl.uniform1f(meshLocations.opacity, opacity);
    let textureBlend = 0.0;
    if (mesh.texCoordBuffer && mesh.texture) {
      if (mesh.role === "existing_imagery_full") { textureBlend = state.imageryVisible ? 1.0 : 0.0; }
      else if (mesh.role === "design" && state.imageryVisible && state.colorMode === "elements") { textureBlend = state.condition === "engineering" ? 0.82 : 1.0; }
    }
    gl.uniform1f(meshLocations.useTexture, textureBlend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mesh.texture || fallbackTexture);
    gl.uniform1i(meshLocations.texture, 0);
    gl.uniform1f(meshLocations.textureBrightness, state.imageryBrightness);
    gl.uniform1f(meshLocations.textureSaturation, state.imagerySaturation);
    gl.uniform1f(meshLocations.textureContrast, state.imageryContrast);
    gl.uniform1f(meshLocations.materialKind, materialKind(mesh));
    gl.uniform1f(meshLocations.materialVariation, state.materialVariation);
    gl.uniform1f(meshLocations.time, (performance.now ? performance.now() : Date.now()) / 1000.0);
    const unlit = mesh.role === "design" || isExistingRole(mesh.role)
      ? 0.0
      : mesh.role === "pile"
        ? 0.42
        : mesh.role === "water"
          ? 0.28
          : 0.08;
    gl.uniform1f(meshLocations.unlit, unlit);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
  }

  function drawWireframes() {
    if (!state.wireframe) {
      return;
    }
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineLocations.viewProjection, false, state.viewProjectionMatrix);
    gl.uniform4f(lineLocations.color, 0.03, 0.055, 0.07, 0.55);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    state.meshes.forEach(function (mesh) {
      if (!roleVisible(mesh) || !mesh.wireIndexBuffer || !mesh.wireIndexCount) {
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
      gl.enableVertexAttribArray(lineLocations.position);
      gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.wireIndexBuffer);
      gl.drawElements(gl.LINES, mesh.wireIndexCount, mesh.wireIndexType, 0);
    });
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawLines() {
    if (state.condition === "existing") {
      return;
    }
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineLocations.viewProjection, false, state.viewProjectionMatrix);
    state.lines.forEach(function (line) {
      if (!line.visible) {
        return;
      }
      if (line.category === "breaklines") {
        if (!state.visibility.breaklines) {
          return;
        }
      } else if (!structureVisibility(line.layerGroup)) {
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, line.positionBuffer);
      gl.enableVertexAttribArray(lineLocations.position);
      gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
      const lineAlpha = line.category === "breaklines" ? 1.0 : state.designOpacity;
      gl.uniform4f(lineLocations.color, line.color[0], line.color[1], line.color[2], lineAlpha);
      gl.drawArrays(gl.LINE_STRIP, 0, line.count);
    });
  }

  function drawGrid() {
    if (!state.grid || !state.visibility.grid) {
      return;
    }
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineLocations.viewProjection, false, state.viewProjectionMatrix);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.grid.positionBuffer);
    gl.enableVertexAttribArray(lineLocations.position);
    gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.uniform4f(lineLocations.color, 0.50, 0.59, 0.64, 0.20);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, state.grid.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function priorityMesh(mesh) {
    if (state.renderPriority === "design") { return mesh.role === "design"; }
    if (state.renderPriority === "structures") { return mesh.role === "pile" || mesh.layerGroup === "rock" || mesh.layerGroup === "large_wood"; }
    return false;
  }

  function drawPriorityOverlay() {
    if (state.renderPriority === "realistic") { return; }
    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(meshLocations.viewProjection, false, state.viewProjectionMatrix);
    const light = lightingValues();
    gl.uniform3fv(meshLocations.lightA, light.primary);
    gl.uniform3fv(meshLocations.lightB, light.fill);
    gl.uniform1f(meshLocations.ambient, light.ambient);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.ALWAYS);
    state.meshes.forEach(function (mesh) { if (priorityMesh(mesh)) { drawMesh(mesh, meshOpacity(mesh) < 0.995); } });
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function render() {
    state.renderPending = false;
    if (state.contextLost) {
      return;
    }
    resizeCanvas();
    updateMatrices();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawGrid();
    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(meshLocations.viewProjection, false, state.viewProjectionMatrix);
    const light = lightingValues();
    gl.uniform3fv(meshLocations.lightA, light.primary);
    gl.uniform3fv(meshLocations.lightB, light.fill);
    gl.uniform1f(meshLocations.ambient, light.ambient);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    state.meshes.forEach(function (mesh) { drawMesh(mesh, false); });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    state.meshes.forEach(function (mesh) { drawMesh(mesh, true); });
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    drawPriorityOverlay();
    drawWireframes();
    if (state.renderPriority === "structures") { gl.depthFunc(gl.ALWAYS); drawLines(); gl.depthFunc(gl.LEQUAL); } else { drawLines(); }
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
    for (const x of [Number(minimum[0]) || 0, Number(maximum[0]) || 0]) {
      for (const y of [Number(minimum[1]) || 0, Number(maximum[1]) || 0]) {
        for (const z of [Number(minimum[2]) || 0, Number(maximum[2]) || 0]) {
          corners.push(dataToRenderPoint(x, y, z));
        }
      }
    }
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
    const opacity = clamp(Number(value), 0.0, 1.0);
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

  function updateEnvironment() {
    let colour = [0.055, 0.086, 0.11, 1.0];
    if (state.displayStyle === "natural") {
      colour = state.lighting === "evening" ? [0.20, 0.16, 0.17, 1.0] : [0.47, 0.65, 0.76, 1.0];
    } else if (state.displayStyle === "construction") {
      colour = [0.36, 0.43, 0.47, 1.0];
    }
    gl.clearColor(colour[0], colour[1], colour[2], colour[3]);
    document.body.dataset.displayStyle = state.displayStyle;
  }

  function setDisplayStyle(style) {
    const value = String(style || "engineering");
    state.displayStyle = ["engineering", "natural", "construction"].indexOf(value) >= 0 ? value : "engineering";
    state.meshes.forEach(refreshMeshColours);
    updateEnvironment();
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
    updateEnvironment();
    updateLegend();
    requestRender();
    return true;
  }

  function setRenderPriority(priority) {
    const value = String(priority || "realistic");
    state.renderPriority = ["realistic", "design", "structures"].indexOf(value) >= 0 ? value : "realistic";
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

  function setImageryAdjustments(brightness, saturation, contrast) {
    state.imageryBrightness = clamp(Number(brightness) || 1.0, 0.4, 2.0);
    state.imagerySaturation = clamp(Number(saturation), 0.0, 2.0);
    if (!Number.isFinite(state.imagerySaturation)) { state.imagerySaturation = 1.0; }
    state.imageryContrast = clamp(Number(contrast) || 1.0, 0.4, 2.0);
    requestRender();
    return true;
  }

  function setMaterialOptions(rockMaterial, timberMaterial, variation) {
    const rocks = ["natural", "fresh", "weathered"];
    const timbers = ["natural", "fresh", "weathered"];
    state.rockMaterial = rocks.indexOf(String(rockMaterial)) >= 0 ? String(rockMaterial) : "natural";
    state.timberMaterial = timbers.indexOf(String(timberMaterial)) >= 0 ? String(timberMaterial) : "natural";
    state.materialVariation = clamp(Number(variation) || 0, 0, 1);
    state.meshes.forEach(refreshMeshColours);
    requestRender();
    return true;
  }

  function setLighting(lighting) {
    const value = String(lighting || "overcast");
    state.lighting = ["overcast", "morning", "midday", "evening"].indexOf(value) >= 0 ? value : "overcast";
    updateEnvironment();
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
    canvas.setPointerCapture(event.pointerId);
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
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture can already have been released by the host window.
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

  function exportImage(width, height) {
    const w = Math.max(320, Math.min(Number(width) || 1920, 8192));
    const h = Math.max(240, Math.min(Number(height) || 1080, 8192));
    state.exportWidth = w;
    state.exportHeight = h;
    render();
    const data = canvas.toDataURL("image/png");
    state.exportWidth = 0;
    state.exportHeight = 0;
    requestRender();
    return data;
  }

  canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("dblclick", function () { fitView(); });
  canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault();
    state.contextLost = true;
    showEmpty("The graphics context was lost. Reopen or refresh 3D Review to rebuild the scene.");
  });
  canvas.addEventListener("webglcontextrestored", function () {
    state.contextLost = false;
    showEmpty("The graphics context was restored. Refresh 3D Review to rebuild GPU resources.");
  });
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

  window.RED3D = {
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
    setRenderPriority: setRenderPriority,
    setImageryVisible: setImageryVisible,
    setImageryAdjustments: setImageryAdjustments,
    setMaterialOptions: setMaterialOptions,
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
    exportImage: exportImage,
    getState: function () {
      return {
        ready: true,
        webgl: true,
        backend: "webgl",
        loaded: Boolean(state.scene),
        meshCount: state.meshes.length,
        lineCount: state.lines.length,
        colorMode: state.colorMode,
        verticalExaggeration: state.verticalExaggeration,
        projection: state.projection,
        displayStyle: state.displayStyle,
        lighting: state.lighting,
        condition: state.condition,
        renderPriority: state.renderPriority,
        imageryVisible: state.imageryVisible,
        imageryBrightness: state.imageryBrightness,
        imagerySaturation: state.imagerySaturation,
        imageryContrast: state.imageryContrast,
        rockMaterial: state.rockMaterial,
        timberMaterial: state.timberMaterial,
        materialVariation: state.materialVariation,
        visibility: Object.assign({}, state.visibility)
      };
    }
  };

  initialiseWebChannel();
  requestRender();
}());
