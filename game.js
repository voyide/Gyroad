"use strict";

/*
  Gyroad (Web/Canvas) — Human vs Bot
  - Uses assets in assets/...
  - Touch-first: pointer events; tap the selected piece again to cancel selection
  - Rotation allowed for DP/DT/DN/C pieces only, with up to 2 rotations per turn
  - Movement pathfinding and layered highlights match original behavior
  - Promotion removes PR/PL reaching the far row and adds to player's score
  - Bot (Player 2) uses iterative deepening + alpha-beta + beam move ordering + rotation planning
*/

(() => {
  // Canvas and sizing
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // UI DOM bits (header/footer)
  const whoTurnEl = document.getElementById("who-turn");
  const botStatusEl = document.getElementById("bot-status");
  const aiTimeEl = document.getElementById("ai-time");
  const aiTimeLabel = document.getElementById("ai-time-label");
  const aiDepthEl = document.getElementById("ai-depth");
  const aiDepthLabel = document.getElementById("ai-depth-label");
  const btnNew = document.getElementById("btn-new");
  const btnHint = document.getElementById("btn-hint");

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
  const BOT_PLAYER = 2;

  // Piece ID counter
  let nextPieceId = 1;

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
      this.id = nextPieceId++;
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

    canBeSelected(currPlayer) {
      return this.player === currPlayer && !this.movedLastTurn && !this.rotatedThisTurn;
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
    // Fallback for non-90 multiples
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

  // Pure helpers for AI (board-parameterized)
  function getAllAccessibleSquaresForBoard(piece, originPiece, boardRef, visitedPositions = new Set(), visitedPieces = new Set()) {
    const accessibleSquares = new Set();
    visitedPieces.add(keyXY(piece.x, piece.y));

    const available = piece.getAvailableSquares();
    const piecesOnAvailable = [];

    for (const pos of available) {
      if (isValidPosition(pos.x, pos.y)) {
        const target = boardRef[pos.y][pos.x];
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
          const res = getAllAccessibleSquaresForBoard(target, originPiece, boardRef, visitedPositions, visitedPieces);
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

  function findMovementPathForBoard(selected, destination, boardRef) {
    const res = getAllAccessibleSquaresForBoard(selected, selected, boardRef);
    const visitedPiecesSet = res.visitedPieces; // Set of "x,y"
    const accessiblePieces = new Set();
    for (const k of visitedPiecesSet) {
      const [px, py] = unkeyXY(k);
      const p = boardRef[py][px];
      if (p && p.player === selected.player) accessiblePieces.add(p);
    }

    const destEmpty = boardRef[destination.y][destination.x] == null;
    const accessibleFirstStep = new Set(accessiblePieces);
    if (destEmpty) accessibleFirstStep.delete(selected);

    const queue = [{ pos: { ...destination }, path: [{ ...destination }] }];
    const visitedPositionsSet = new Set([keyXY(destination.x, destination.y)]);

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
          if (!visitedPositionsSet.has(pkey)) {
            visitedPositionsSet.add(pkey);
            queue.push({ pos: { x: p.x, y: p.y }, path: [...path, { x: p.x, y: p.y }] });
          }
        }
      }
    }
    return null;
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

  function getAllAccessibleSquares(selected, originPiece, visitedPositions = new Set(), visitedPieces = new Set()) {
    return getAllAccessibleSquaresForBoard(selected, originPiece, board, visitedPositions, visitedPieces);
  }

  function findMovementPath(selected, destination) {
    return findMovementPathForBoard(selected, destination, board);
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
    updateHeaderStatus();
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
    if (currentPlayer === BOT_PLAYER) return; // block during bot turn
    if (ai.isThinking) return;

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
    const vh = Math.max(480, Math.floor(window.innerHeight) - 160); // account header/footer

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
    nextPieceId = 1;
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
    for (const p of pieces) {
      p.rotation = 0;
      p.targetRotation = 0;
      p.isRotating = false;
      p.relativeDirsCache.clear();
    }
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
    rebuildBoard();
    updateHeaderStatus();
  }

  function updateHeaderStatus() {
    whoTurnEl.textContent = currentPlayer === 1 ? "Player 1’s turn" : "Player 2 (Bot)’s turn";
    if (currentPlayer === BOT_PLAYER) {
      botStatusEl.innerHTML = `<span class="spinner"></span>Bot: thinking`;
    } else {
      botStatusEl.textContent = "Bot: ready";
    }
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
          }
        }
        // Win check
        if (playerScores[1] >= 6 || playerScores[2] >= 6) {
          gameOver = true;
          gameOverMessage =
            (playerScores[1] >= 6 && playerScores[2] >= 6) ? "Draw!" :
            (playerScores[1] >= 6 ? "Player 1 Wins!" : "Player 2 Wins!");
        }

        if (!gameOver) {
          endTurn();
        } else {
          setTimeout(resetGame, 3000);
        }
      }
    }

    // If bot's turn and idle, trigger bot
    maybeStartBotTurn();
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

    // Controls
    aiTimeEl.addEventListener("input", () => {
      ai.timeLimitMs = parseInt(aiTimeEl.value, 10);
      aiTimeLabel.textContent = `${ai.timeLimitMs} ms`;
    });
    aiDepthEl.addEventListener("input", () => {
      ai.maxDepth = parseInt(aiDepthEl.value, 10);
      aiDepthLabel.textContent = `${ai.maxDepth}`;
    });
    btnNew.addEventListener("click", () => {
      resetGame();
    });
    btnHint.addEventListener("click", async () => {
      if (currentPlayer !== 1 || piecesAreAnimating || ai.isThinking) return;
      const state = snapshotState();
      const suggestion = ai.computeBestAction(state);
      if (!suggestion) return;
      // Flash reachable destination
      const dest = suggestion.move.dest;
      highlightedPositions.clear();
      emptyAccessibleSquares.clear();
      occupiedAccessibleSquares.clear();
      const key = keyXY(dest.x, dest.y);
      emptyAccessibleSquares.add(key);
      highlightedPositions.add(key);
      setTimeout(() => {
        highlightedPositions.clear();
        emptyAccessibleSquares.clear();
      }, 900);
    });
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

  // ======================
  // Bot (AI) Implementation
  // ======================

  function clonePiece(p) {
    const c = new Piece(p.x, p.y, p.type, p.player, p.flipped);
    c.id = p.id;
    c.rotation = p.rotation;
    c.targetRotation = p.rotation;
    c.isRotating = false;
    c.relativeDirsCache = new Map(); // fresh cache in clone
    c.movedLastTurn = p.movedLastTurn;
    c.rotatedThisTurn = p.rotatedThisTurn;
    return c;
  }

  function snapshotState() {
    const ps = pieces.map(clonePiece);
    const idMap = new Map(ps.map(pc => [pc.id, pc]));
    const b = makeEmptyBoard();
    for (const p of ps) b[p.y][p.x] = p;
    return {
      pieces: ps,
      board: b,
      idMap,
      currentPlayer,
      rotationChances,
      playerScores: { 1: playerScores[1], 2: playerScores[2] },
      gameOver: gameOver
    };
  }

  function stateRebuildBoard(state) {
    state.board = makeEmptyBoard();
    for (const p of state.pieces) state.board[p.y][p.x] = p;
  }

  function canRotateType(type) {
    const t = type.replace(/e$/, "");
    return t === "DP" || t === "DT" || t === "DN" || t === "C";
  }

  function otherPlayer(p) {
    return p === 1 ? 2 : 1;
  }

  // Heuristic evaluation
  function evaluateState(state, perspectivePlayer) {
    const opp = otherPlayer(perspectivePlayer);
    if (state.playerScores[perspectivePlayer] >= 6 && state.playerScores[opp] >= 6) return 0;
    if (state.playerScores[perspectivePlayer] >= 6) return 100000;
    if (state.playerScores[opp] >= 6) return -100000;

    let score = 0;

    // Scoring weight for actual score lead
    score += (state.playerScores[perspectivePlayer] - state.playerScores[opp]) * 5000;

    // Piece values and positioning
    const centerX = (BOARD_WIDTH - 1) / 2;
    const centerY = (BOARD_HEIGHT - 1) / 2;
    for (const p of state.pieces) {
      const t = p.type.replace(/e$/, "");
      const me = p.player === perspectivePlayer ? 1 : -1;

      // Base piece value (small, since no capture)
      const baseVal =
        t === "C" ? 40 :
        t === "DN" || t === "DT" || t === "DP" ? 30 :
        t === "PX" ? 22 :
        18; // PR/PL

      score += me * baseVal;

      // Advancement for PR/PL (towards promotion)
      if (t === "PR" || t === "PL") {
        const dist = (p.player === 1) ? p.y : (BOARD_HEIGHT - 1 - p.y); // distance to far row
        score += me * (40 - dist * 6);
      }

      // Mobility (immediate)
      const av = p.getAvailableSquares();
      let mobile = 0, pressure = 0;
      for (const sq of av) {
        if (!isValidPosition(sq.x, sq.y)) continue;
        const target = state.board[sq.y][sq.x];
        if (!target) mobile++;
        else if (target.player !== p.player) { mobile += 1; pressure += 1; }
        else mobile += 1; // chain contributes options
      }
      score += me * (mobile * 2 + pressure * 2);

      // Centralization
      const md = Math.abs(p.x - centerX) + Math.abs(p.y - centerY);
      score += me * (8 - md);
    }

    return score;
  }

  function encodeStateKey(state) {
    // Simple string key (fast enough for short search)
    // id:x,y,rot;...|cp|s1,s2
    const parts = state.pieces
      .slice()
      .sort((a,b)=>a.id-b.id)
      .map(p => `${p.id}:${p.x},${p.y},${((p.rotation%360)+360)%360}`)
      .join(";");
    return `${parts}|${state.currentPlayer}|${state.playerScores[1]},${state.playerScores[2]}`;
  }

  class GyroadAI {
    constructor(opts = {}) {
      this.timeLimitMs = opts.timeLimitMs ?? 140;
      this.maxDepth = opts.maxDepth ?? 3;
      this.beamWidth = opts.beamWidth ?? 12;
      this.rotationK = opts.rotationK ?? 2; // top K rotation candidates
      this.isThinking = false;
      this.TT = new Map(); // transposition table (key -> {depth, value, move})
    }

    computeBestAction(state) {
      const start = performance.now();
      this.TT.clear();
      let best = null;
      let bestScore = -Infinity;
      let timeUp = false;

      const rootColor = state.currentPlayer === 2 ? 1 : -1; // perspective = bot player
      const timeLimit = this.timeLimitMs;

      for (let depth = 1; depth <= this.maxDepth; depth++) {
        const res = this.negamax(state, depth, -Infinity, Infinity, rootColor, start, timeLimit, { timeUp: false });
        timeUp = res.timeUp;
        if (res.bestAction) {
          best = res.bestAction;
          bestScore = res.score;
        }
        if (timeUp) break;
      }
      return best;
    }

    thinkAndMove() {
      if (this.isThinking) return;
      if (currentPlayer !== BOT_PLAYER) return;
      this.isThinking = true;
      updateHeaderStatus();

      // Slight timeout so UI updates spinner
      setTimeout(() => {
        const state = snapshotState();
        const best = this.computeBestAction(state);
        this.isThinking = false;
        updateHeaderStatus();
        if (!best) return;

        // Apply rotations first (no animation)
        if (best.rotations && best.rotations.length) {
          rotationChances = 2;
          for (const r of best.rotations) {
            const p = pieces.find(pp => pp.id === r.id);
            if (!p) continue;
            for (let i = 0; i < r.times; i++) {
              p.rotation = (p.rotation - 90 + 360) % 360;
              p.rotatedThisTurn = true;
              rotationChances = Math.max(0, rotationChances - 1);
            }
            p.relativeDirsCache.clear();
          }
        }

        // Execute move (animate)
        const move = best.move;
        const realPiece = pieces.find(pp => pp.id === move.id);
        if (!realPiece) return;
        const dest = { x: move.dest.x, y: move.dest.y };
        const path = findMovementPath(realPiece, dest);
        if (!path) return;

        const targetPiece = board[dest.y][dest.x];
        if (!targetPiece) {
          // Move only
          realPiece.movementPath = path;
          realPiece.isMoving = true;
          realPiece.currentSegmentIndex = 0;
          // Clear board at origin
          board[realPiece.y][realPiece.x] = null;
          animatingPieces = [realPiece];
          piecesAreAnimating = true;
        } else {
          // Swap
          realPiece.movementPath = path;
          realPiece.isMoving = true;
          realPiece.currentSegmentIndex = 0;

          targetPiece.movementPath = [{ x: targetPiece.x, y: targetPiece.y }, { x: realPiece.x, y: realPiece.y }];
          targetPiece.isMoving = true;
          targetPiece.currentSegmentIndex = 0;

          board[realPiece.y][realPiece.x] = targetPiece;
          board[targetPiece.y][targetPiece.x] = null;

          animatingPieces = [realPiece, targetPiece];
          piecesAreAnimating = true;
        }

        // Clear selection & highlights
        selectedPiece = null;
        highlightedPositions.clear();
        emptyAccessibleSquares.clear();
        occupiedAccessibleSquares.clear();
        accessibleHighlightLayers = [];
        currentHighlightLayer = 0;
        highlightingInProgress = false;
      }, 0);
    }

    negamax(state, depth, alpha, beta, color, start, timeLimit, flag) {
      const now = performance.now();
      if (now - start > timeLimit) {
        flag.timeUp = true;
        return { score: 0, bestAction: null, timeUp: true };
      }

      const key = encodeStateKey(state);
      const tt = this.TT.get(key);
      if (tt && tt.depth >= depth) {
        return { score: tt.value, bestAction: tt.move, timeUp: false };
      }

      if (depth === 0 || state.gameOver) {
        const evalScore = evaluateState(state, BOT_PLAYER) * color;
        return { score: evalScore, bestAction: null, timeUp: false };
      }

      const actions = this.generateTurnActionsLimited(state);
      if (actions.length === 0) {
        // No move found: evaluate
        const evalScore = evaluateState(state, BOT_PLAYER) * color;
        return { score: evalScore, bestAction: null, timeUp: false };
      }

      // Move ordering by shallow eval
      const ordered = actions.map(a => {
        const s2 = this.applyAction(cloneState(state), a);
        const val = evaluateState(s2, BOT_PLAYER) * color;
        return { a, val };
      }).sort((A,B)=>B.val-A.val).slice(0, this.beamWidth);

      let bestAction = null;
      let bestValue = -Infinity;

      let a = alpha;
      for (const item of ordered) {
        if (flag.timeUp) break;
        const action = item.a;
        const child = this.applyAction(cloneState(state), action);
        const res = this.negamax(child, depth - 1, -beta, -a, -color, start, timeLimit, flag);
        if (flag.timeUp) break;
        const value = -res.score;

        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
        a = Math.max(a, value);
        if (a >= beta) break; // beta cut
      }

      if (!flag.timeUp) {
        this.TT.set(key, { depth, value: bestValue, move: bestAction });
      }

      return { score: bestValue, bestAction, timeUp: flag.timeUp };
    }

    // Generate rotation plans + moves, pruned
    generateTurnActionsLimited(state) {
      const me = state.currentPlayer;

      // Candidate rotations: compute delta mobility for each rotatable piece
      const rotables = state.pieces.filter(p => p.player === me && canRotateType(p.type));
      const rotCandidates = [];
      for (const p of rotables) {
        const baseMob = this.mobilityForPiece(state, p);
        // simulate one rotation
        p.rotation = (p.rotation - 90 + 360) % 360;
        p.relativeDirsCache.clear?.();
        const mob1 = this.mobilityForPiece(state, p);
        // simulate second rotation (180 total)
        p.rotation = (p.rotation - 90 + 360) % 360;
        p.relativeDirsCache.clear?.();
        const mob2 = this.mobilityForPiece(state, p);
        // revert rotation
        p.rotation = (p.rotation + 180) % 360;
        p.relativeDirsCache.clear?.();

        rotCandidates.push({
          p,
          delta1: mob1 - baseMob,
          delta2: mob2 - baseMob
        });
      }
      rotCandidates.sort((a,b) => (b.delta1 + b.delta2*0.6) - (a.delta1 + a.delta2*0.6));
      const top = rotCandidates.slice(0, this.rotationK);

      // Build rotation plans: none, [p1], [p2?], [p1x2], [p1+p2]
      const rotationPlans = [[]];
      if (top.length >= 1) {
        rotationPlans.push([{ id: top[0].p.id, times: 1 }]);
        rotationPlans.push([{ id: top[0].p.id, times: 2 }]);
      }
      if (top.length >= 2) {
        rotationPlans.push([{ id: top[1].p.id, times: 1 }]);
        rotationPlans.push([{ id: top[0].p.id, times: 1 }, { id: top[1].p.id, times: 1 }]);
      }

      const actions = [];
      for (const plan of rotationPlans) {
        const s2 = cloneState(state);
        // apply rotations (up to 2)
        let remaining = 2;
        for (const r of plan) {
          if (remaining <= 0) break;
          const times = Math.min(r.times, remaining);
          const p = s2.idMap.get(r.id);
          if (!p || !canRotateType(p.type)) continue;
          for (let i=0;i<times;i++){
            p.rotation = (p.rotation - 90 + 360) % 360;
            p.relativeDirsCache.clear?.();
            remaining--;
          }
        }

        // Generate moves after rotations
        const moves = this.generateMovesForState(s2);
        // Order moves heuristically (advancement, swaps first)
        moves.sort((A,B)=>B.score - A.score);
        const limited = moves.slice(0, this.beamWidth);
        for (const mv of limited) {
          actions.push({ rotations: plan, move: mv.move });
        }
      }

      return actions;
    }

    generateMovesForState(state) {
      const me = state.currentPlayer;
      const res = [];
      for (const p of state.pieces) {
        if (p.player !== me) continue;
        if (p.movedLastTurn || p.rotatedThisTurn) continue;
        const acc = getAllAccessibleSquaresForBoard(p, p, state.board).accessibleSquares;
        for (const k of acc) {
          const [x, y] = unkeyXY(k);
          const dest = { x, y };
          const target = state.board[y][x];
          const t = p.type.replace(/e$/, "");
          const promoRow = (p.player === 1) ? 0 : (BOARD_HEIGHT - 1);
          const willPromote = (t === "PR" || t === "PL") && y === promoRow;
          const isSwap = !!target;
          // Simple move score for ordering
          const centerX = (BOARD_WIDTH - 1) / 2;
          const centerY = (BOARD_HEIGHT - 1) / 2;
          const md = Math.abs(x - centerX) + Math.abs(y - centerY);
          let score = 0;
          if (willPromote) score += 10000;
          if (isSwap && target.player !== p.player) score += 40;
          score += (8 - md);
          if (t === "PR" || t === "PL") {
            const adv = (p.player === 1) ? (p.y - y) : (y - p.y);
            score += adv * 10;
          }
          res.push({
            move: { id: p.id, dest },
            score
          });
        }
      }
      return res;
    }

    mobilityForPiece(state, p) {
      const acc = getAllAccessibleSquaresForBoard(p, p, state.board).accessibleSquares;
      return acc.size;
    }

    applyAction(state, action) {
      // apply rotations (consume chances conceptually)
      let chances = 2;
      if (action.rotations) {
        for (const r of action.rotations) {
          if (chances <= 0) break;
          const times = Math.min(r.times, chances);
          const p = state.idMap.get(r.id);
          if (!p || !canRotateType(p.type)) continue;
          for (let i=0;i<times;i++){
            p.rotation = (p.rotation - 90 + 360) % 360;
            p.relativeDirsCache.clear?.();
            chances--;
          }
        }
      }

      // Move
      const mv = action.move;
      const sel = state.idMap.get(mv.id);
      if (!sel) return state;
      const dest = { x: mv.dest.x, y: mv.dest.y };
      const target = state.board[dest.y][dest.x];

      // Remove origin
      state.board[sel.y][sel.x] = null;

      if (!target) {
        // Move only
        sel.x = dest.x; sel.y = dest.y;
        state.board[sel.y][sel.x] = sel;
      } else {
        // Swap (target to origin)
        const ox = sel.x, oy = sel.y;
        sel.x = dest.x; sel.y = dest.y;
        state.board[sel.y][sel.x] = sel;

        target.x = ox; target.y = oy;
        state.board[oy][ox] = target;
      }

      // Promotion check for moved piece
      const t = sel.type.replace(/e$/, "");
      const promoRow = (sel.player === 1) ? 0 : (BOARD_HEIGHT - 1);
      if ((t === "PR" || t === "PL") && sel.y === promoRow) {
        // remove piece and score
        state.board[sel.y][sel.x] = null;
        state.pieces = state.pieces.filter(pp => pp.id !== sel.id);
        state.idMap.delete(sel.id);
        state.playerScores[sel.player] += 1;
      }

      // End turn
      state.currentPlayer = otherPlayer(state.currentPlayer);
      // Reset flags for next player
      for (const p of state.pieces) {
        if (p.player === state.currentPlayer) {
          p.movedLastTurn = false;
          p.rotatedThisTurn = false;
        } else {
          if (p.movedLastTurn) p.movedLastTurn = false;
        }
      }
      // Game over?
      if (state.playerScores[1] >= 6 || state.playerScores[2] >= 6) {
        state.gameOver = true;
      }
      return state;
    }
  }

  function cloneState(state) {
    // Deep clone to avoid mutating original
    const ps = state.pieces.map(clonePiece);
    const idMap = new Map(ps.map(pc => [pc.id, pc]));
    const b = makeEmptyBoard();
    for (const p of ps) b[p.y][p.x] = p;
    return {
      pieces: ps,
      board: b,
      idMap,
      currentPlayer: state.currentPlayer,
      rotationChances: state.rotationChances,
      playerScores: { 1: state.playerScores[1], 2: state.playerScores[2] },
      gameOver: state.gameOver
    };
  }

  // Bot instance
  const ai = new GyroadAI({
    timeLimitMs: parseInt(aiTimeEl?.value || "140", 10),
    maxDepth: parseInt(aiDepthEl?.value || "3", 10),
    beamWidth: 12,
    rotationK: 2
  });

  function maybeStartBotTurn() {
    if (gameOver) return;
    if (piecesAreAnimating) return;
    if (currentPlayer !== BOT_PLAYER) return;
    if (ai.isThinking) return;
    ai.thinkAndMove();
  }
})();
