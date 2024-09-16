const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Adjust canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight - 150; // Reserve space for buttons and UI

const BOARD_WIDTH = 7;
const BOARD_HEIGHT = 8;

const SQUARE_SIZE = Math.min(
  Math.floor(canvas.width / BOARD_WIDTH),
  Math.floor(canvas.height / BOARD_HEIGHT)
);

// Adjust canvas size to fit the board
canvas.width = SQUARE_SIZE * BOARD_WIDTH;
canvas.height = SQUARE_SIZE * BOARD_HEIGHT;

// Colors
const COLORS = {
  WHITE: '#FFFFFF',
  BLACK: '#000000',
  BLUE_HIGHLIGHT: 'rgba(0, 0, 255, 0.5)',
  SELECTED_HIGHLIGHT: 'rgba(0, 255, 0, 0.5)',
  ORANGE_EMPTY: 'rgba(255, 165, 0, 0.5)',
  PURPLE_OCCUPIED: 'rgba(128, 0, 128, 0.5)',
  GRAY: '#808080',
  DARK_GREEN: '#008000',
  DARK_RED: '#800000',
  YELLOW: '#FFFF00',
  DARK_YELLOW: '#808000',
};

// UI Elements
const rotateButton = document.getElementById('rotateButton');
const doneButton = document.getElementById('doneButton');
const cancelButton = document.getElementById('cancelButton');
const scoreDiv = document.getElementById('score');
const turnDiv = document.getElementById('turn');
const rotationsDiv = document.getElementById('rotations');

// Button Event Listeners
rotateButton.addEventListener('click', handleRotateButton);
doneButton.addEventListener('click', handleDoneButton);
cancelButton.addEventListener('click', handleCancelButton);

// Assets
const IMAGES = {};

// List of piece types and their corresponding image file names
const PIECE_TYPES = [
  'PR', 'PL', 'PX', 'DP', 'DT', 'DN', 'C',
  'PRe', 'PLe', 'PXe', 'DPe', 'DTe', 'DNe', 'Ce'
];

// Load images
let assetsLoaded = 0;
const totalAssets = PIECE_TYPES.length * 2; // Original and flipped images

PIECE_TYPES.forEach(type => {
  loadPieceImage(type);
  loadPieceImage(type + '_flipped', true);
});

function loadPieceImage(type, flipped = false) {
  const img = new Image();
  const filename = flipped ? type.replace('_flipped', '') : type;
  img.src = `assets/sprites/${filename}.png`;
  img.onload = () => {
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
      initGame();
    }
  };
  IMAGES[type] = img;
}

// Game Variables
let board = [];
let pieces = [];
let selectedPiece = null;
let highlightedPositions = new Set();
let emptyAccessibleSquares = new Set();
let occupiedAccessibleSquares = new Set();
let rotateMode = false;
let currentPlayer = 1;
let rotationChances = 2;
let playerScores = { 1: 0, 2: 0 };
let gameOver = false;

// Initialize the game
function initGame() {
  // Initialize board
  board = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));

  // Initialize pieces and place them on the board
  pieces = createPieces();
  pieces.forEach(piece => {
    if (isValidPosition(piece.x, piece.y)) {
      board[piece.y][piece.x] = piece;
    } else {
      console.error(`Invalid initial position for piece: ${piece.type} at (${piece.x}, ${piece.y})`);
    }
  });

  // Event Listeners
  canvas.addEventListener('mousedown', handleMouseDown);

  // Start the game loop
  requestAnimationFrame(gameLoop);
}

// Game Loop
function gameLoop() {
  update();
  draw();
  if (!gameOver) {
    requestAnimationFrame(gameLoop);
  } else {
    drawGameOver();
  }
}

// Update game state
function update() {
  pieces.forEach(piece => {
    piece.update();
  });
}

// Draw the game
function draw() {
  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw board
  drawBoard();

  // Draw highlights
  if (highlightedPositions.size > 0) {
    if (!rotateMode) {
      drawHighlights(emptyAccessibleSquares, COLORS.ORANGE_EMPTY);
      drawHighlights(occupiedAccessibleSquares, COLORS.PURPLE_OCCUPIED);
    }
  }

  // Highlight selected piece
  if (selectedPiece) {
    drawHighlights(new Set([[selectedPiece.x, selectedPiece.y]]), COLORS.SELECTED_HIGHLIGHT);
  }

  // Draw pieces
  drawPieces();

  // Update UI
  updateUI();
}

// Draw game over screen
function drawGameOver() {
  ctx.fillStyle = COLORS.BLACK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = COLORS.WHITE;
  ctx.font = '72px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let text = '';
  if (playerScores[1] >= 5 && playerScores[2] >= 5) {
    text = 'Draw!';
  } else if (playerScores[1] >= 5) {
    text = 'Player 1 Wins!';
  } else if (playerScores[2] >= 5) {
    text = 'Player 2 Wins!';
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

// Handle mouse down events
function handleMouseDown(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / SQUARE_SIZE);
  const y = Math.floor((event.clientY - rect.top) / SQUARE_SIZE);

  if (rotateMode) {
    // Rotate mode interactions
    if (selectedPiece && x === selectedPiece.x && y === selectedPiece.y) {
      selectedPiece.rotate();
    }
  } else {
    // Normal mode interactions
    if (selectedPiece === null) {
      const clickedPiece = board[y][x];
      if (clickedPiece && clickedPiece.canBeSelected(currentPlayer)) {
        selectedPiece = clickedPiece;
        const accessibleSquares = getAllAccessibleSquares(selectedPiece, selectedPiece);
        highlightedPositions = accessibleSquares;
        emptyAccessibleSquares = new Set(
          [...highlightedPositions].filter(([x, y]) => board[y][x] === 0)
        );
        occupiedAccessibleSquares = new Set(
          [...highlightedPositions].filter(([x, y]) => board[y][x] !== 0)
        );
      }
    } else {
      if (x === selectedPiece.x && y === selectedPiece.y) {
        deselectPiece();
      } else if (highlightedPositions.has(`${x},${y}`)) {
        const targetPiece = board[y][x];
        if (!targetPiece) {
          // Move piece
          board[selectedPiece.y][selectedPiece.x] = 0;
          selectedPiece.x = x;
          selectedPiece.y = y;
          board[y][x] = selectedPiece;
          selectedPiece.movedLastTurn = true;
          handlePromotion(selectedPiece);
          deselectPiece();
          endTurn();
        } else {
          // Swap pieces
          swapPieces(selectedPiece, targetPiece);
          selectedPiece.movedLastTurn = true;
          if (targetPiece.player !== currentPlayer) {
            targetPiece.movedLastTurn = true;
          }
          handlePromotion(selectedPiece);
          deselectPiece();
          endTurn();
        }
      } else {
        deselectPiece();
      }
    }
  }
}

// Handle rotate button
function handleRotateButton() {
  if (rotationChances > 0) {
    if (selectedPiece && selectedPiece.canRotate()) {
      rotateMode = true;
      highlightedPositions.clear();
      emptyAccessibleSquares.clear();
      occupiedAccessibleSquares.clear();
      selectedPiece.initialRotation = selectedPiece.rotation % 360;
      selectedPiece.targetRotation = selectedPiece.rotation % 360;
      selectedPiece.isRotating = false;
    } else {
      rotateMode = false;
    }
  } else {
    rotateMode = false;
  }
}

// Handle done button
function handleDoneButton() {
  if (rotateMode) {
    rotationChances--;
    if (selectedPiece) {
      selectedPiece.rotatedThisTurn = true;
    }
    rotateMode = false;
    deselectPiece();
  }
}

// Handle cancel button
function handleCancelButton() {
  if (rotateMode) {
    rotateMode = false;
    if (selectedPiece) {
      selectedPiece.isRotating = false;
      selectedPiece.rotation = selectedPiece.initialRotation % 360;
      selectedPiece.targetRotation = selectedPiece.initialRotation % 360;
      selectedPiece.updateImage();
      const accessibleSquares = getAllAccessibleSquares(selectedPiece, selectedPiece);
      highlightedPositions = accessibleSquares;
      emptyAccessibleSquares = new Set(
        [...highlightedPositions].filter(([x, y]) => board[y][x] === 0)
      );
      occupiedAccessibleSquares = new Set(
        [...highlightedPositions].filter(([x, y]) => board[y][x] !== 0)
      );
    }
  }
}

// Deselect the current piece
function deselectPiece() {
  selectedPiece = null;
  highlightedPositions.clear();
  emptyAccessibleSquares.clear();
  occupiedAccessibleSquares.clear();
}

// End the current player's turn
function endTurn() {
  currentPlayer = currentPlayer === 1 ? 2 : 1;
  rotationChances = 2;
  pieces.forEach(piece => {
    if (piece.player === currentPlayer) {
      piece.movedLastTurn = false;
      piece.rotatedThisTurn = false;
    } else {
      if (piece.movedLastTurn) {
        piece.movedLastTurn = false;
      }
    }
  });
}

// Handle promotion of a piece
function handlePromotion(piece) {
  const promotionRow = currentPlayer === 1 ? 0 : BOARD_HEIGHT - 1;
  if (['PR', 'PL', 'PRe', 'PLe'].includes(piece.type) && piece.y === promotionRow) {
    board[piece.y][piece.x] = null;
    pieces = pieces.filter(p => p !== piece);
    playerScores[currentPlayer]++;
    if (playerScores[currentPlayer] >= 5) {
      gameOver = true;
    }
  }
}

// Update UI elements
function updateUI() {
  scoreDiv.textContent = `Player 1: ${playerScores[1]}    Player 2: ${playerScores[2]}`;
  turnDiv.textContent = `Player ${currentPlayer}'s turn`;
  rotationsDiv.textContent = `Rotations left: ${rotationChances}`;
  rotateButton.disabled = !selectedPiece || !selectedPiece.canRotate() || rotationChances <= 0;
  doneButton.disabled = !rotateMode;
  cancelButton.disabled = !rotateMode;
}

// Draw the game board
function drawBoard() {
  ctx.fillStyle = COLORS.GRAY;
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      ctx.fillRect(x * SQUARE_SIZE, y * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
      ctx.strokeStyle = COLORS.WHITE;
      ctx.strokeRect(x * SQUARE_SIZE, y * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
    }
  }
}

// Draw highlighted squares
function drawHighlights(squares, color) {
  ctx.fillStyle = color;
  squares.forEach(pos => {
    const [x, y] = pos.split(',').map(Number);
    ctx.fillRect(x * SQUARE_SIZE, y * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
  });
}

// Draw all pieces
function drawPieces() {
  pieces.forEach(piece => {
    piece.draw();
  });
}

// Check if position is within the board bounds
function isValidPosition(x, y) {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

// Swap two pieces on the board
function swapPieces(piece1, piece2) {
  [board[piece1.y][piece1.x], board[piece2.y][piece2.x]] = [piece2, piece1];
  [piece1.x, piece2.x] = [piece2.x, piece1.x];
  [piece1.y, piece2.y] = [piece2.y, piece1.y];
}

// Create initial pieces
function createPieces() {
  const p = [];
  // Player 1 pieces
  p.push(new Piece(0, 7, 'DP', 1));
  p.push(new Piece(1, 7, 'DT', 1));
  p.push(new Piece(2, 7, 'DN', 1));
  p.push(new Piece(3, 7, 'C', 1));
  p.push(new Piece(4, 7, 'DN', 1));
  p.push(new Piece(5, 7, 'DT', 1));
  p.push(new Piece(6, 7, 'DP', 1));
  p.push(new Piece(0, 6, 'PR', 1));
  p.push(new Piece(1, 6, 'PL', 1));
  p.push(new Piece(2, 6, 'PR', 1));
  p.push(new Piece(3, 6, 'PX', 1));
  p.push(new Piece(4, 6, 'PL', 1));
  p.push(new Piece(5, 6, 'PR', 1));
  p.push(new Piece(6, 6, 'PL', 1));
  // Player 2 pieces
  p.push(new Piece(0, 0, 'DPe', 2, true));
  p.push(new Piece(1, 0, 'DTe', 2, true));
  p.push(new Piece(2, 0, 'DNe', 2, true));
  p.push(new Piece(3, 0, 'Ce', 2, true));
  p.push(new Piece(4, 0, 'DNe', 2, true));
  p.push(new Piece(5, 0, 'DTe', 2, true));
  p.push(new Piece(6, 0, 'DPe', 2, true));
  p.push(new Piece(0, 1, 'PLe', 2, true));
  p.push(new Piece(1, 1, 'PRe', 2, true));
  p.push(new Piece(2, 1, 'PLe', 2, true));
  p.push(new Piece(3, 1, 'PXe', 2, true));
  p.push(new Piece(4, 1, 'PRe', 2, true));
  p.push(new Piece(5, 1, 'PLe', 2, true));
  p.push(new Piece(6, 1, 'PRe', 2, true));
  return p;
}

// Get all accessible squares for a piece
function getAllAccessibleSquares(piece, originPiece, visitedPositions = new Set(), visitedPieces = new Set()) {
  const accessibleSquares = new Set();
  visitedPieces.add(`${piece.x},${piece.y}`);

  const availableSquares = piece.getAvailableSquares();
  const piecesOnAvailable = [];

  availableSquares.forEach(([nx, ny]) => {
    if (isValidPosition(nx, ny)) {
      const targetPiece = board[ny][nx];
      if (targetPiece) {
        accessibleSquares.add(`${nx},${ny}`);
        piecesOnAvailable.push(targetPiece);
      }
    }
  });

  piecesOnAvailable.forEach(targetPiece => {
    if (targetPiece.player === piece.player && !visitedPieces.has(`${targetPiece.x},${targetPiece.y}`)) {
      if (targetPiece.x !== originPiece.x || targetPiece.y !== originPiece.y) {
        const [newSquares, newVisitedPositions, newVisitedPieces] = getAllAccessibleSquares(
          targetPiece,
          originPiece,
          visitedPositions,
          visitedPieces
        );
        newSquares.forEach(sq => accessibleSquares.add(sq));
      }
    } else if (targetPiece.player !== piece.player) {
      accessibleSquares.add(`${targetPiece.x},${targetPiece.y}`);
    }
  });

  piecesOnAvailable.forEach(targetPiece => {
    if (targetPiece.player === piece.player) {
      if (targetPiece.x !== originPiece.x || targetPiece.y !== originPiece.y) {
        const targetAvailableSquares = targetPiece.getAvailableSquares();
        targetAvailableSquares.forEach(([tx, ty]) => {
          if (isValidPosition(tx, ty) && !visitedPositions.has(`${tx},${ty}`)) {
            visitedPositions.add(`${tx},${ty}`);
            if (!board[ty][tx]) {
              accessibleSquares.add(`${tx},${ty}`);
            } else {
              accessibleSquares.add(`${tx},${ty}`);
            }
          }
        });
      }
    }
  });

  return accessibleSquares;
}

// Piece Class
class Piece {
  constructor(x, y, type, player, flipped = false) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.player = player;
    this.flipped = flipped;
    this.rotation = 0;
    this.targetRotation = 0;
    this.rotationSpeed = 15;
    this.isRotating = false;
    this.movedLastTurn = false;
    this.rotatedThisTurn = false;
    this.rotationAngle = 0;
    this.updateImage();
  }

  updateImage() {
    const key = this.flipped ? `${this.type}_flipped` : this.type;
    this.baseImage = IMAGES[key];
  }

  draw() {
    if (!this.baseImage) return;
    ctx.save();
    const centerX = (this.x + 0.5) * SQUARE_SIZE;
    const centerY = (this.y + 0.5) * SQUARE_SIZE;
    ctx.translate(centerX, centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.drawImage(
      this.baseImage,
      -SQUARE_SIZE / 2,
      -SQUARE_SIZE / 2,
      SQUARE_SIZE,
      SQUARE_SIZE
    );
    ctx.restore();
  }

  update() {
    if (this.isRotating) {
      if (this.rotation !== this.targetRotation) {
        let rotationDiff = (this.targetRotation - this.rotation + 360) % 360;
        if (rotationDiff > 180) {
          rotationDiff -= 360;
        }
        const rotationStep = Math.min(this.rotationSpeed, Math.abs(rotationDiff));
        if (rotationDiff > 0) {
          this.rotation = (this.rotation + rotationStep) % 360;
        } else {
          this.rotation = (this.rotation - rotationStep + 360) % 360;
        }
        if (this.rotation === this.targetRotation) {
          this.isRotating = false;
        }
      }
    }
  }

  rotate() {
    this.isRotating = true;
    this.targetRotation = (this.targetRotation - 90 + 360) % 360;
  }

  canBeSelected(currentPlayer) {
    return (
      this.player === currentPlayer &&
      !this.movedLastTurn &&
      !this.rotatedThisTurn
    );
  }

  canRotate() {
    return (
      ['DP', 'DT', 'DN', 'C', 'DPe', 'DTe', 'DNe', 'Ce'].includes(this.type) &&
      !this.rotatedThisTurn &&
      this.player === currentPlayer
    );
  }

  getAvailableSquares() {
    const x = this.x;
    const y = this.y;
    const rotation = this.rotation % 360;
    let up, down, left, right;

    if (this.player === 1) {
      up = [0, -1];
      down = [0, 1];
      left = [-1, 0];
      right = [1, 0];
    } else {
      up = [0, 1];
      down = [0, -1];
      left = [1, 0];
      right = [-1, 0];
    }

    let dirs = [];

    const type = this.type.replace('e', '');
    switch (type) {
      case 'PR':
        dirs = [left, [right[0], right[1] + up[1]]];
        break;
      case 'PL':
        dirs = [right, [left[0], left[1] + up[1]]];
        break;
      case 'PX':
        dirs = [
          [right[0] + up[0], right[1] + up[1]],
          [right[0] + down[0], right[1] + down[1]],
          [left[0] + up[0], left[1] + up[1]],
          [left[0] + down[0], left[1] + down[1]],
        ];
        break;
      case 'DP':
        dirs = [up, [up[0] * 2, up[1] * 2], left, right];
        break;
      case 'DT':
        dirs = [
          up,
          [up[0] + left[0], up[1] + left[1]],
          [up[0] + right[0], up[1] + right[1]],
          down,
        ];
        break;
      case 'DN':
        dirs = [up, down, [left[0] * 2, left[1] * 2], [right[0] * 2, right[1] * 2]];
        break;
      case 'C':
        dirs = [up, [down[0] + left[0], down[1] + left[1]], [down[0] + right[0], down[1] + right[1]]];
        break;
      default:
        break;
    }

    const adjustedDirs = dirs.map(([dx, dy]) => {
      return this.rotateDirection(dx, dy, -rotation);
    });

    const availableSquares = adjustedDirs.map(([dx, dy]) => [x + dx, y + dy])
      .filter(([nx, ny]) => isValidPosition(nx, ny));

    return availableSquares;
  }

  rotateDirection(dx, dy, angle) {
    const angleRad = (angle * Math.PI) / 180;
    const cosTheta = Math.round(Math.cos(angleRad));
    const sinTheta = Math.round(Math.sin(angleRad));
    const nx = cosTheta * dx - sinTheta * dy;
    const ny = sinTheta * dx + cosTheta * dy;
    return [nx, ny];
  }
}
