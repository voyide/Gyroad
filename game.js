"use strict";

/*
  Gyroad (Web/Canvas)
  - Uses your existing assets in assets/...
  - Touch-first: pointer events; tap the selected piece again to cancel selection
  - Rotation allowed for DP/DT/DN/C pieces only, with 2 rotations per turn
  - Movement pathfinding and layered highlights match original behavior
  - Promotion removes PR/PL reaching the far row and adds to player's score
*/

(() => {
  // Canvas and sizing
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Board constants
  const BOARD_WIDTH = 7;
  const BOARD_HEIGHT = 8;
  const UI_HEIGHT = 150;

  // Colors
  const WHITE = "#ffffff";
  const BLACK = "#000000";
  const GRAY = "#808080";
  const DARK_GREEN = "#008000";
  const DARK_RED = "#800000";
  const DARK_YELLOW = "#808000";

  // Game state
  let SQUARE_SIZE = 64;
  let SCREEN_WIDTH = SQUARE_SIZE * BOARD_WIDTH;
  let SCREEN_HEIGHT = SQUARE_SIZE * BOARD_HEIGHT + UI_HEIGHT;

  // UI buttons (computed after size)
  let rotateButton = { x: 0, y: 0, w: 0, h: 0 };
  let doneButton = { x: 0, y: 0, w: 0, h: 0 };
  let cancelButton = { x: 0, y: 0, w: 0, h: 0 };

  // Assets
  const assets = {
    board: null,
    highlightSelect: null,
    highlightEmpty: null,
    highlightSwap: null,
    sprites: new Map(), // key -> HTMLImageElement
  };

  // Game data
  let pieces = [];
  let board = [];
  let selectedPiece = null;
  let rotateMode = false;
  let currentPlayer = 1;
  let rotationChances = 2;
  let playerScores = { 1: 0, 2: 0 };
  let gameOver = false;
  let gameOverMessage = "";

  // Highlighting (progressive layers)
  let accessibleHighlightLayers = []; // array of [emptySet, occupiedSet]
  let highlightedPositions = new Set(); // "x,y"
  let emptyAccessibleSquares = new Set(); // "x,y"
  let occupiedAccessibleSquares = new Set(); // "x,y"
  let currentHighlightLayer = 0;
  let lastLayerUpdateTime = 0;
  const layerDelay = 80; // ms
  let highlightingInProgress = false;

  // Animations
  let lastFrameTime = performance.now();
  let piecesAreAnimating = false;
  let animatingPieces = [];

  // Utility
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  function keyXY(x, y) {
    return `${x},${y}`;
  }
  function unkeyXY(k) {
    const [xs, ys] = k.split(",");
    return [parseInt(xs, 10), parseInt(ys, 10)];
  }

  function easeInOutCubic(t) {
    if (t < 0.5) return 4 * t * t * t;
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Piece class
  class Piece {
    constructor(x, y, type, player, flipped = false) {
      this.x = x;
      this.y = y;
      this.type = type; // e.g., "PR", "DPe", etc.
      this.player = player; // 1 or 2
      this.flipped = flipped; // enemy baseline 180°
      this.initialRotation = 0;
      this.targetRotation = 0;
      this.rotation = 0; // degrees
      this.rotationSpeed = 15; // deg per frame @60fps (we scale by dt)
      this.isRotating = false;
      this.relativeDirsCache = new Map(); // angle -> dirs
      this.movedLastTurn = false;
      this.rotatedThisTurn = false;

      this.movementPath = []; // [{x,y}, ...]
      this.isMoving = false;
      this.currentSegmentIndex = 0;
      this.moveSpeed = 300; // px per second
      this.drawPosition = this.gridToCenter(this.x, this.y);
      this.movementTotalTime = null;
      this.movementElapsedTime = 0;
    }

    gridToCenter(x, y) {
      return { x: (x + 0.5) * SQUARE_SIZE, y: (y + 0.5) * SQUARE_SIZE };
    }

    rotate() {
      this.isRotating = true;
      this.targetRotation = (this.targetRotation - 90 + 360) % 360;
    }

    update(dt) {
      // Rotation animation
      if (this.isRotating) {
        if (this.rotation !== this.targetRotation) {
          let diff = (this.targetRotation - this.rotation + 360) % 360;
          if (diff > 180) diff -= 360;
          const step = Math.min(this.rotationSpeed * (dt * 60), Math.abs(diff));
          this.rotation = (this.rotation + Math.sign(diff) * step + 360) % 360;
          if (Math.abs(((this.rotation - this.targetRotation) + 540) % 360 - 180) < 0.001) {
            this.rotation = this.targetRotation;
            this.isRotating = false;
          }
        } else {
          this.isRotating = false;
        }
      }

      // Movement animation
      if (this.isMoving) {
        if (this.currentSegmentIndex < this.movementPath.length - 1) {
          const start = this.movementPath[this.currentSegmentIndex];
          const end = this.movementPath[this.currentSegmentIndex + 1];
          const sp = this.gridToCenter(start.x, start.y);
          const ep = this.gridToCenter(end.x, end.y);
          const dx = ep.x - sp.x;
          const dy = ep.y - sp.y;
          const dist = Math.hypot(dx, dy);

          if (this.movementTotalTime === null) {
            this.movementTotalTime = dist / this.moveSpeed;
            this.movementElapsedTime = 0;
          }
          this.movementElapsedTime += dt;
          const t = Math.min(1, this.movementElapsedTime / this.movementTotalTime);
          const et = easeInOutCubic(t);
          this.drawPosition = { x: sp.x + dx * et, y: sp.y + dy * et };

          if (t >= 1) {
            this.currentSegmentIndex += 1;
            this.movementElapsedTime = 0;
            this.movementTotalTime = null;
          }
        } else {
          this.isMoving = false;
          const last = this.movementPath[this.movementPath.length - 1];
          this.x = last.x;
          this.y = last.y;
          this.drawPosition = this.gridToCenter(this.x, this.y);
          this.movementPath = [];
          this.currentSegmentIndex = 0;
          this.movementTotalTime = null;
          this.movementElapsedTime = 0;
        }
      }
    }

    canBeSelected(currentPlayer) {
      return this.player === currentPlayer && !this.movedLastTurn && !this.rotatedThisTurn;
    }

    getAvailableSquares() {
      const x = this.x, y = this.y;
      const rotation = ((this.rotation % 360) + 360) % 360;

      let up, down, left, right;
      if (this.player === 1) {
        up = { x: 0, y: -1 };
        down = { x: 0, y: 1 };
        left = { x: -1, y: 0 };
        right = { x: 1, y: 0 };
      } else {
        up = { x: 0, y: 1 };
        down = { x: 0, y: -1 };
        left = { x: 1, y: 0 };
        right = { x: -1, y: 0 };
      }

      const t = this.type.replace(/e$/, "");
      let dirs = [];
      if (t === "PR") {
        dirs = [left, { x: right.x, y: right.y + down.y }];
      } else if (t === "PL") {
        dirs = [right, { x: left.x, y: left.y + down.y }];
      } else if (t === "PX") {
        dirs = [
          { x: right.x + up.x, y: right.y + up.y },
          { x: right.x + down.x, y: right.y + down.y },
          { x: left.x + up.x, y: left.y + up.y },
          { x: left.x + down.x, y: left.y + down.y },
        ];
      } else if (t === "DP") {
        dirs = [up, { x: up.x * 2, y: up.y * 2 }, left, right];
      } else if (t === "DT") {
        dirs = [up, { x: up.x + left.x, y: up.y + left.y }, { x: up.x + right.x, y: up.y + right.y }, down];
      } else if (t === "DN") {
        dirs = [up, down, { x: left.x * 2, y: left.y * 2 }, { x: right.x * 2, y: right.y * 2 }];
      } else if (t === "C") {
        dirs = [up, { x: down.x + left.x, y: down.y + left.y }, { x: down.x + right.x, y: down.y + right.y }];
      }

      const angle = (-rotation + 360) % 360;
      let adjusted = this.relativeDirsCache.get(angle);
      if (!adjusted) {
        adjusted = dirs.map(d => rotateDir(d.x, d.y, angle));
        this.relativeDirsCache.set(angle, adjusted);
      }

      const result = [];
      for (const d of adjusted) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (isValidPosition(nx, ny)) {
          result.push({ x: nx, y: ny });
        }
      }
      return result;
    }

    draw(ctx) {
      const sprite = assets.sprites.get(this.type);
      if (!sprite) return;
      const cx = this.drawPosition.x;
      const cy = this.drawPosition.y;
      const baseAngle = this.flipped ? Math.PI : 0; // 180° baseline for enemy
      const totalAngle = baseAngle + (this.rotation * Math.PI) / 180;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(totalAngle);
      ctx.drawImage(sprite, -SQUARE_SIZE / 2, -SQUARE_SIZE / 2, SQUARE_SIZE, SQUARE_SIZE);
      ctx.restore();
    }
  }

  function rotateDir(dx, dy, angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 0) return { x: dx, y: dy };
    if (a === 90) return { x: -dy, y: dx };
    if (a === 180) return { x: -dx, y: -dy };
    if (a === 270) return { x: dy, y: -dx };
    // Fallback, shouldn't be used (only multiples of 90 for logic)
    const rad = (a * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    return { x: cos * dx - sin * dy, y: sin * dx + cos * dy };
  }

  // Board helpers
  function isValidPosition(x, y) {
    return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
  }

  function pointToSquare(px, py) {
    const bx = Math.floor(px / SQUARE_SIZE);
    const by = Math.floor(py / SQUARE_SIZE);
    if (bx < 0 || bx >= BOARD_WIDTH || by < 0 || by >= BOARD_HEIGHT) return null;
    return { x: bx, y: by };
  }

  // Highlight layers (progressive)
  function getAccessibleHighlightLayers(selected) {
    const layers = [];
    const visitedPieces = new Set();
    const visitedPositions = new Set();
    let currentLayerPieces = new Set([selected]);
    visitedPieces.add(selected);

    while (currentLayerPieces.size > 0) {
      const emptyLayer = new Set();
      const occupiedLayer = new Set();
      const nextLayerPieces = new Set();

      for (const piece of currentLayerPieces) {
        let available;
        if (piece === selected) {
          // For initial piece: only squares that are occupied
          const check = piece.getAvailableSquares();
          available = [];
          for (const pos of check) {
            if (board[pos.y][pos.x]) available.push(pos);
          }
        } else {
          available = piece.getAvailableSquares();
        }

        for (const pos of available) {
          if (!isValidPosition(pos.x, pos.y)) continue;
          const key = keyXY(pos.x, pos.y);
          if (visitedPositions.has(key)) continue;

          const target = board[pos.y][pos.x];
          if (!target) {
            emptyLayer.add(key);
          } else {
            occupiedLayer.add(key);
            if (target.player === selected.player && !visitedPieces.has(target)) {
              nextLayerPieces.add(target);
              visitedPieces.add(target);
            }
          }
        }
      }

      if (emptyLayer.size > 0 || occupiedLayer.size > 0) {
        layers.push([emptyLayer, occupiedLayer]);
      }

      for (const k of emptyLayer) visitedPositions.add(k);
      for (const k of occupiedLayer) visitedPositions.add(k);
      currentLayerPieces = nextLayerPieces;
    }

    return layers;
  }

  function getAllAccessibleSquares(piece, originPiece, visitedPositions = new Set(), visitedPieces = new Set()) {
    const accessibleSquares = new Set();
    visitedPieces.add(keyXY(piece.x, piece.y));

    const available = piece.getAvailableSquares();
    const piecesOnAvailable = [];

    for (const pos of available) {
      if (isValidPosition(pos.x, pos.y)) {
        const target = board[pos.y][pos.x];
        if (target) {
          accessibleSquares.add(keyXY(pos.x, pos.y));
          piecesOnAvailable.push(target);
        }
      }
    }

    for (const target of piecesOnAvailable) {
      const tkey = keyXY(target.x, target.y);
      if (target.player === piece.player && !visitedPieces.has(tkey)) {
        if (tkey !== keyXY(originPiece.x, originPiece.y)) {
          const res = getAllAccessibleSquares(target, originPiece, visitedPositions, visitedPieces);
          for (const k of res.accessibleSquares) accessibleSquares.add(k);
        }
      } else if (target.player !== piece.player) {
        accessibleSquares.add(tkey);
      }
    }

    for (const target of piecesOnAvailable) {
      const tkey = keyXY(target.x, target.y);
      if (target.player === piece.player && tkey !== keyXY(originPiece.x, originPiece.y)) {
        const targetAvail = target.getAvailableSquares();
        for (const pos of targetAvail) {
          const k = keyXY(pos.x, pos.y);
          if (isValidPosition(pos.x, pos.y) && !visitedPositions.has(k)) {
            visitedPositions.add(k);
            accessibleSquares.add(k);
          }
        }
      }
    }

    return { accessibleSquares, visitedPositions, visitedPieces };
  }

  function findMovementPath(selected, destination) {
    const res = getAllAccessibleSquares(selected, selected);
    const visitedPieces = res.visitedPieces; // Set of "x,y"
    const accessiblePieces = new Set();
    for (const k of visitedPieces) {
      const [px, py] = unkeyXY(k);
      const p = board[py][px];
      if (p && p.player === selected.player) accessiblePieces.add(p);
    }

    const destEmpty = board[destination.y][destination.x] == null;
    const accessibleFirstStep = new Set(accessiblePieces);
    if (destEmpty) accessibleFirstStep.delete(selected);

    const queue = [{ pos: { ...destination }, path: [{ ...destination }] }];
    const visitedPositions = new Set([keyXY(destination.x, destination.y)]);

    while (queue.length > 0) {
      const { pos, path } = queue.shift();
      if (pos.x === selected.x && pos.y === selected.y) {
        return path.slice().reverse(); // array of {x,y}
      }

      const consider = (path.length === 1) ? accessibleFirstStep : accessiblePieces;
      for (const p of consider) {
        const pAvail = p.getAvailableSquares();
        if (pAvail.some(s => s.x === pos.x && s.y === pos.y)) {
          const pkey = keyXY(p.x, p.y);
          if (!visitedPositions.has(pkey)) {
            visitedPositions.add(pkey);
            queue.push({ pos: { x: p.x, y: p.y }, path: [...path, { x: p.x, y: p.y }] });
          }
        }
      }
    }
    return null;
  }

  // Turn and scoring
  function endTurn() {
    currentPlayer = (currentPlayer === 1) ? 2 : 1;
    rotationChances = 2;
    for (const piece of pieces) {
      if (piece.player === currentPlayer) {
        piece.movedLastTurn = false;
        piece.rotatedThisTurn = false;
      } else {
        if (piece.movedLastTurn) piece.movedLastTurn = false;
      }
    }
  }

  // Board + drawing
  function drawBoard() {
    ctx.drawImage(assets.board, 0, 0, SQUARE_SIZE * BOARD_WIDTH, SQUARE_SIZE * BOARD_HEIGHT);
  }

  function drawHighlightFromSet(set, img) {
    for (const k of set) {
      const [x, y] = unkeyXY(k);
      ctx.drawImage(img, x * SQUARE_SIZE, y * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
    }
  }

  function drawButtons() {
    // Rotate toggle
    ctx.fillStyle = rotateMode ? DARK_YELLOW : DARK_RED;
    fillRect(rotateButton);
    drawButtonLabel(rotateButton, "Rotate");

    if (rotateMode) {
      ctx.fillStyle = DARK_GREEN;
      fillRect(doneButton);
      drawButtonLabel(doneButton, "Done");

      ctx.fillStyle = DARK_RED;
      fillRect(cancelButton);
      drawButtonLabel(cancelButton, "Cancel");
    }
  }

  function fillRect(r) {
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  function drawButtonLabel(rect, text) {
    ctx.fillStyle = BLACK;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  function drawUI() {
    // Score and turn
    const scoreText = `Player 1: ${playerScores[1]}    Player 2: ${playerScores[2]}`;
    const turnText = `Player ${currentPlayer}'s turn`;
    const rotationText = `Rotations left: ${rotationChances}`;

    ctx.fillStyle = WHITE;
    ctx.font = "20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(scoreText, 10, SCREEN_HEIGHT - UI_HEIGHT + 10);

    ctx.textAlign = "right";
    ctx.fillText(turnText, SCREEN_WIDTH - 10, SCREEN_HEIGHT - UI_HEIGHT + 10);
    ctx.fillText(rotationText, SCREEN_WIDTH - 10, SCREEN_HEIGHT - UI_HEIGHT + 40);
  }

  function rebuildBoard() {
    board = makeEmptyBoard();
    for (const p of pieces) {
      board[p.y][p.x] = p;
    }
  }

  // Input
  function onPointerDown(ev) {
    if (gameOver) return;

    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    // Ignore if animating
    if (piecesAreAnimating) return;

    // Buttons
    if (inRect(x, y, rotateButton)) {
      if (!rotateMode) {
        if (rotationChances > 0) {
          if (
            selectedPiece &&
            ["DP", "DT", "DN", "C"].includes(selectedPiece.type.replace(/e$/, "")) &&
            selectedPiece.player === currentPlayer &&
            !selectedPiece.rotatedThisTurn
          ) {
            rotateMode = true;
            // Prepare rotation state
            selectedPiece.initialRotation = selectedPiece.rotation;
            selectedPiece.targetRotation = selectedPiece.rotation;
            selectedPiece.isRotating = false;
            // Clear highlights while rotating
            highlightedPositions.clear();
            emptyAccessibleSquares.clear();
            occupiedAccessibleSquares.clear();
            accessibleHighlightLayers = [];
            currentHighlightLayer = 0;
            highlightingInProgress = false;
          } else {
            rotateMode = false;
          }
        } else {
          rotateMode = false;
        }
      } else {
        // Already in rotate mode; do nothing here (use Done/Cancel)
      }
      return;
    }

    if (rotateMode) {
      if (inRect(x, y, doneButton)) {
        rotationChances -= 1;
        if (selectedPiece) selectedPiece.rotatedThisTurn = true;
        rotateMode = false;
        selectedPiece = null;
        highlightedPositions.clear();
        emptyAccessibleSquares.clear();
        occupiedAccessibleSquares.clear();
        accessibleHighlightLayers = [];
        currentHighlightLayer = 0;
        highlightingInProgress = false;
        return;
      }
      if (inRect(x, y, cancelButton)) {
        rotateMode = false;
        if (selectedPiece) {
          selectedPiece.isRotating = false;
          selectedPiece.rotation = selectedPiece.initialRotation;
          selectedPiece.targetRotation = selectedPiece.initialRotation;
        }
        // Rebuild highlights for current selection
        if (selectedPiece) {
          accessibleHighlightLayers = getAccessibleHighlightLayers(selectedPiece);
          highlightedPositions.clear();
          emptyAccessibleSquares.clear();
          occupiedAccessibleSquares.clear();
          currentHighlightLayer = 0;
          lastLayerUpdateTime = performance.now();
          highlightingInProgress = true;
        }
        return;
      }

      // If tapping the selected piece while in rotate mode -> rotate 90°
      const boardAreaHeight = SQUARE_SIZE * BOARD_HEIGHT;
      if (y < boardAreaHeight) {
        const sq = pointToSquare(x, y);
        if (sq && selectedPiece && sq.x === selectedPiece.x && sq.y === selectedPiece.y) {
          selectedPiece.rotate();
        }
      }
      return;
    }

    // Board interactions
    const boardAreaHeight = SQUARE_SIZE * BOARD_HEIGHT;
    if (y < boardAreaHeight) {
      const sq = pointToSquare(x, y);
      if (!sq) return;

      const clickedPiece = board[sq.y][sq.x];

      if (!selectedPiece) {
        if (clickedPiece && clickedPiece.canBeSelected(currentPlayer)) {
          selectedPiece = clickedPiece;
          accessibleHighlightLayers = getAccessibleHighlightLayers(selectedPiece);
          highlightedPositions.clear();
          emptyAccessibleSquares.clear();
          occupiedAccessibleSquares.clear();
          currentHighlightLayer = 0;
          lastLayerUpdateTime = performance.now();
          highlightingInProgress = true;
        }
      } else {
        // Tap selected piece again to cancel
        if (sq.x === selectedPiece.x && sq.y === selectedPiece.y) {
          selectedPiece = null;
          highlightedPositions.clear();
          emptyAccessibleSquares.clear();
          occupiedAccessibleSquares.clear();
          accessibleHighlightLayers = [];
          currentHighlightLayer = 0;
          highlightingInProgress = false;
          return;
        }

        // Move/swap if tapping a highlighted square
        const k = keyXY(sq.x, sq.y);
        if (highlightedPositions.has(k)) {
          const path = findMovementPath(selectedPiece, sq);
          if (path) {
            const targetPiece = board[sq.y][sq.x];
            if (!targetPiece) {
              // Move only
              selectedPiece.movementPath = path;
              selectedPiece.isMoving = true;
              selectedPiece.currentSegmentIndex = 0;
              // Clear board at origin
              board[selectedPiece.y][selectedPiece.x] = null;
              animatingPieces = [selectedPiece];
              piecesAreAnimating = true;
            } else {
              // Swap
              selectedPiece.movementPath = path;
              selectedPiece.isMoving = true;
              selectedPiece.currentSegmentIndex = 0;

              targetPiece.movementPath = [{ x: targetPiece.x, y: targetPiece.y }, { x: selectedPiece.x, y: selectedPiece.y }];
              targetPiece.isMoving = true;
              targetPiece.currentSegmentIndex = 0;

              board[selectedPiece.y][selectedPiece.x] = targetPiece;
              board[targetPiece.y][targetPiece.x] = null;

              animatingPieces = [selectedPiece, targetPiece];
              piecesAreAnimating = true;
            }

            // Clear selection and highlights
            selectedPiece = null;
            highlightedPositions.clear();
            emptyAccessibleSquares.clear();
            occupiedAccessibleSquares.clear();
            accessibleHighlightLayers = [];
            currentHighlightLayer = 0;
            highlightingInProgress = false;
          }
        }
      }
    }
  }

  // Rect and UI helpers
  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function computeUILayout() {
    const buttonWidth = Math.min(150, (SCREEN_WIDTH - 30) / 2);
    const buttonHeight = 50;

    rotateButton = {
      x: (SCREEN_WIDTH / 2) - (buttonWidth / 2),
      y: (SQUARE_SIZE * BOARD_HEIGHT) + 25,
      w: buttonWidth,
      h: buttonHeight
    };
    doneButton = {
      x: (SCREEN_WIDTH / 2) - buttonWidth - 10,
      y: (SQUARE_SIZE * BOARD_HEIGHT) + 80,
      w: buttonWidth,
      h: buttonHeight
    };
    cancelButton = {
      x: (SCREEN_WIDTH / 2) + 10,
      y: (SQUARE_SIZE * BOARD_HEIGHT) + 80,
      w: buttonWidth,
      h: buttonHeight
    };
  }

  // Resize to fit viewport, compute square size
  function resize() {
    const vw = Math.max(320, Math.floor(window.innerWidth));
    const vh = Math.max(480, Math.floor(window.innerHeight));

    SQUARE_SIZE = Math.max(48, Math.min(Math.floor(vw / BOARD_WIDTH), Math.floor((vh - UI_HEIGHT) / BOARD_HEIGHT)));
    SCREEN_WIDTH = SQUARE_SIZE * BOARD_WIDTH;
    SCREEN_HEIGHT = SQUARE_SIZE * BOARD_HEIGHT + UI_HEIGHT;

    canvas.style.width = `${SCREEN_WIDTH}px`;
    canvas.style.height = `${SCREEN_HEIGHT}px`;
    canvas.width = Math.floor(SCREEN_WIDTH * DPR);
    canvas.height = Math.floor(SCREEN_HEIGHT * DPR);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    computeUILayout();
  }

  // Assets loading
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load ${src}`));
      img.src = src;
    });
  }

  async function loadAssets() {
    // Board and highlights
    assets.board = await loadImage("assets/board/B.jpeg");
    assets.highlightSelect = await loadImage("assets/board/selecth.png");
    assets.highlightEmpty = await loadImage("assets/board/emptyh.png");
    assets.highlightSwap = await loadImage("assets/board/swaph.png");

    // Piece sprites
    const baseTypes = ["PR", "PL", "PX", "DP", "DT", "DN", "C"];
    for (const t of baseTypes) {
      const img = await loadImage(`assets/sprites/${t}.png`);
      assets.sprites.set(t, img);

      const te = `${t}e`;
      const imge = await loadImage(`assets/sprites/${te}.png`);
      assets.sprites.set(te, imge);
    }
  }

  // Init board/pieces
  function makeEmptyBoard() {
    const b = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      b.push(new Array(BOARD_WIDTH).fill(null));
    }
    return b;
  }

  function initPieces() {
    pieces = [
      new Piece(0, 7, "DP", 1), new Piece(1, 7, "DT", 1), new Piece(2, 7, "DN", 1),
      new Piece(3, 7, "C", 1),  new Piece(4, 7, "DN", 1), new Piece(5, 7, "DT", 1),
      new Piece(6, 7, "DP", 1),

      new Piece(0, 6, "PR", 1), new Piece(1, 6, "PL", 1), new Piece(2, 6, "PR", 1),
      new Piece(3, 6, "PX", 1), new Piece(4, 6, "PL", 1), new Piece(5, 6, "PR", 1),
      new Piece(6, 6, "PL", 1),

      new Piece(0, 0, "DPe", 2, true), new Piece(1, 0, "DTe", 2, true),
      new Piece(2, 0, "DNe", 2, true), new Piece(3, 0, "Ce", 2, true),
      new Piece(4, 0, "DNe", 2, true), new Piece(5, 0, "DTe", 2, true),
      new Piece(6, 0, "DPe", 2, true),

      new Piece(0, 1, "PLe", 2, true), new Piece(1, 1, "PRe", 2, true),
      new Piece(2, 1, "PLe", 2, true), new Piece(3, 1, "PXe", 2, true),
      new Piece(4, 1, "PRe", 2, true), new Piece(5, 1, "PLe", 2, true),
      new Piece(6, 1, "PRe", 2, true),
    ];
    board = makeEmptyBoard();
    for (const p of pieces) {
      if (!isValidPosition(p.x, p.y)) throw new Error(`Invalid piece position ${p.type} at ${p.x},${p.y}`);
      board[p.y][p.x] = p;
    }
  }

  function resetGame() {
    selectedPiece = null;
    rotateMode = false;
    currentPlayer = 1;
    rotationChances = 2;
    playerScores = { 1: 0, 2: 0 };
    gameOver = false;
    gameOverMessage = "";
    accessibleHighlightLayers = [];
    highlightedPositions.clear();
    emptyAccessibleSquares.clear();
    occupiedAccessibleSquares.clear();
    currentHighlightLayer = 0;
    highlightingInProgress = false;
    piecesAreAnimating = false;
    animatingPieces = [];
    initPieces();
  }

  // Main loop
  function update(dt) {
    // Update pieces
    for (const p of pieces) p.update(dt);

    // Progressive highlight layer reveal
    if (highlightingInProgress && currentHighlightLayer < accessibleHighlightLayers.length) {
      const now = performance.now();
      if (now - lastLayerUpdateTime >= layerDelay) {
        const [emptyLayer, occupiedLayer] = accessibleHighlightLayers[currentHighlightLayer];
        for (const k of emptyLayer) {
          emptyAccessibleSquares.add(k);
          highlightedPositions.add(k);
        }
        for (const k of occupiedLayer) {
          occupiedAccessibleSquares.add(k);
          highlightedPositions.add(k);
        }
        currentHighlightLayer += 1;
        lastLayerUpdateTime = now;

        if (currentHighlightLayer >= accessibleHighlightLayers.length) {
          highlightingInProgress = false;
        }
      }
    }

    // End of movement animations
    if (piecesAreAnimating) {
      if (animatingPieces.every(p => !p.isMoving)) {
        piecesAreAnimating = false;
        animatingPieces = [];

        rebuildBoard();

        // Promotion: PR/PL on far row
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i];
          const t = p.type.replace(/e$/, "");
          const promoRow = (p.player === 1) ? 0 : (BOARD_HEIGHT - 1);
          if ((t === "PR" || t === "PL") && p.y === promoRow) {
            board[p.y][p.x] = null;
            pieces.splice(i, 1);
            playerScores[p.player] += 1;
            if (playerScores[p.player] >= 6) {
              gameOver = true;
              gameOverMessage = (playerScores[1] >= 6 && playerScores[2] >= 6)
                ? "Draw!"
                : (p.player === 1 ? "Player 1 Wins!" : "Player 2 Wins!");
            }
          }
        }

        if (!gameOver) endTurn();
        else {
          // Show message for 3 seconds, then reset
          setTimeout(resetGame, 3000);
        }
      }
    }
  }

  function render() {
    // Clear
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // Board
    drawBoard();

    // Highlights
    if (highlightedPositions.size > 0 && !rotateMode) {
      drawHighlightFromSet(emptyAccessibleSquares, assets.highlightEmpty);
      drawHighlightFromSet(occupiedAccessibleSquares, assets.highlightSwap);
    }

    if (selectedPiece && !rotateMode) {
      const k = keyXY(selectedPiece.x, selectedPiece.y);
      const [sx, sy] = unkeyXY(k);
      ctx.drawImage(assets.highlightSelect, sx * SQUARE_SIZE, sy * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
    }

    // Pieces
    for (const p of pieces) p.draw(ctx);

    // Buttons and UI
    drawButtons();
    drawUI();

    // Game over message overlay
    if (gameOver && gameOverMessage) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      ctx.fillStyle = WHITE;
      ctx.font = "48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(gameOverMessage, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
      ctx.restore();
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000); // clamp dt
    lastFrameTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  // Boot
  function attachEvents() {
    // Touch-first pointer handling
    canvas.addEventListener("pointerdown", onPointerDown, { passive: true });

    // Prevent context menu so long-press won't be weird on some devices
    document.addEventListener("contextmenu", (e) => {
      if (e.target === canvas) e.preventDefault();
    }, { capture: true });

    window.addEventListener("resize", resize);
  }

  function start() {
    resize();
    attachEvents();
    resetGame();
    requestAnimationFrame((t) => {
      lastFrameTime = t;
      requestAnimationFrame(loop);
    });
  }

  // Load everything
  (async function init() {
    try {
      resize();
      await loadAssets();
      start();
    } catch (err) {
      console.error(err);
      ctx.fillStyle = WHITE;
      ctx.font = "16px sans-serif";
      ctx.fillText("Failed to load assets. Check console.", 10, 24);
    }
  })();
})();
