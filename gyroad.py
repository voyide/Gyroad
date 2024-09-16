import pygame
import sys
import math

pygame.init()
screen_info = pygame.display.Info()
SCREEN_WIDTH = screen_info.current_w
SCREEN_HEIGHT = screen_info.current_h
BOARD_WIDTH = 7
BOARD_HEIGHT = 8
SQUARE_SIZE = min(SCREEN_WIDTH // BOARD_WIDTH, (SCREEN_HEIGHT - 150) // BOARD_HEIGHT)

SCREEN_WIDTH = SQUARE_SIZE * BOARD_WIDTH
SCREEN_HEIGHT = SQUARE_SIZE * BOARD_HEIGHT + 150

# Define colors
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
BLUE_HIGHLIGHT = (0, 0, 255, 128)
SELECTED_HIGHLIGHT = (0, 255, 0, 128)
ORANGE_EMPTY = (255, 165, 0, 128)
PURPLE_OCCUPIED = (128, 0, 128, 128)
GRAY = (128, 128, 128)
DARK_GREEN = (0, 128, 0)
DARK_RED = (128, 0, 0)
YELLOW = (255, 255, 0)
DARK_YELLOW = (128, 128, 0)

# Initialize screen
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Gyroad")

# Load and scale the board image
try:
    board_image_raw = pygame.image.load('assets/board/B.jpeg').convert()
except pygame.error:
    print("Error loading board image. Please ensure 'assets/board/B.jpeg' exists.")
    sys.exit()

# Scale the board image to fit the board area
board_image = pygame.transform.scale(board_image_raw, (SQUARE_SIZE * BOARD_WIDTH, SQUARE_SIZE * BOARD_HEIGHT))

# Initialize the board with empty squares
board = [[0 for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]

# Load and scale piece images
IMAGES = {}
for piece_type in ['PR', 'PL', 'PX', 'DP', 'DT', 'DN', 'C']:
    # Load Player 1 images
    try:
        original_image = pygame.image.load(f'assets/sprites/{piece_type}.png').convert_alpha()
    except pygame.error:
        print(f"Error loading image for piece type: {piece_type}. Please ensure the file exists.")
        sys.exit()
    IMAGES[piece_type] = pygame.transform.scale(original_image, (SQUARE_SIZE, SQUARE_SIZE))

    # Load Player 2 (Enemy) images with 'e' appended
    enemy_piece_type = piece_type + 'e'  # e.g., 'PRe'
    try:
        enemy_image = pygame.image.load(f'assets/sprites/{enemy_piece_type}.png').convert_alpha()
    except pygame.error:
        print(f"Error loading image for enemy piece type: {enemy_piece_type}. Please ensure the file exists.")
        sys.exit()
    IMAGES[enemy_piece_type] = pygame.transform.scale(enemy_image, (SQUARE_SIZE, SQUARE_SIZE))

    # Handle flipped images for Player 1
    IMAGES[piece_type + '_flipped'] = pygame.transform.rotate(IMAGES[piece_type], 180)
    # Handle flipped images for Player 2
    IMAGES[enemy_piece_type + '_flipped'] = pygame.transform.rotate(IMAGES[enemy_piece_type], 180)

class Piece:
    def __init__(self, x, y, piece_type, player, flipped=False):
        self.x = x
        self.y = y
        self.type = piece_type  # e.g., 'PR', 'PLe'
        self.player = player
        self.flipped = flipped
        self.initial_rotation = 0
        self.target_rotation = 0
        self.rotation = 0
        self.rotation_speed = 15
        self.is_rotating = False
        self.update_image()
        self.moved_last_turn = False
        self.rotated_this_turn = False

    def update_image(self):
        if self.player == 1:
            key = self.type + ('_flipped' if self.flipped else '')
        else:
            key = self.type + ('_flipped' if self.flipped else '')  # 'PRe' or 'PLe' etc.
        base_image = IMAGES.get(key, None)
        if base_image:
            self.image = pygame.transform.rotate(base_image, self.rotation)
        else:
            print(f"Image key '{key}' not found.")
            sys.exit()

    def draw(self):
        rect = self.image.get_rect(center=((self.x + 0.5) * SQUARE_SIZE, (self.y + 0.5) * SQUARE_SIZE))
        screen.blit(self.image, rect)

    def rotate(self):
        self.is_rotating = True
        self.target_rotation = (self.target_rotation - 90) % 360

    def update(self):
        if self.is_rotating:
            if self.rotation != self.target_rotation:
                rotation_diff = (self.target_rotation - self.rotation) % 360
                if rotation_diff > 180:
                    rotation_diff -= 360
                rotation_step = min(self.rotation_speed, abs(rotation_diff))
                if rotation_diff > 0:
                    self.rotation = (self.rotation + rotation_step) % 360
                else:
                    self.rotation = (self.rotation - rotation_step) % 360

                if self.rotation == self.target_rotation:
                    self.is_rotating = False
                self.update_image()

    def can_be_selected(self, current_player):
        return self.player == current_player and not self.moved_last_turn and not self.rotated_this_turn

    def get_available_squares(self):
        x, y = self.x, self.y
        rotation = self.rotation % 360
        if self.player == 1:
            up = (0, -1)
            down = (0, 1)
            left = (-1, 0)
            right = (1, 0)
        else:
            up = (0, 1)
            down = (0, -1)
            left = (1, 0)
            right = (-1, 0)

        dirs = []

        if self.type.rstrip('e') == 'PR':
            dirs = [left, (right[0], right[1] + up[1])]
        elif self.type.rstrip('e') == 'PL':
            dirs = [right, (left[0], left[1] + up[1])]
        elif self.type.rstrip('e') == 'PX':
            dirs = [
                (right[0] + up[0], right[1] + up[1]),
                (right[0] + down[0], right[1] + down[1]),
                (left[0] + up[0], left[1] + up[1]),
                (left[0] + down[0], left[1] + down[1]),
            ]
        elif self.type.rstrip('e') == 'DP':
            dirs = [up, (up[0]*2, up[1]*2), left, right]
        elif self.type.rstrip('e') == 'DT':
            dirs = [up, (up[0]+left[0], up[1]+left[1]), (up[0]+right[0], up[1]+right[1]), down]
        elif self.type.rstrip('e') == 'DN':
            dirs = [up, down, (left[0]*2, left[1]*2), (right[0]*2, right[1]*2)]
        elif self.type.rstrip('e') == 'C':
            dirs = [up, (down[0]+left[0], down[1]+left[1]), (down[0]+right[0], down[1]+right[1])]

        adjusted_dirs = []
        angle = -self.rotation % 360
        for dx, dy in dirs:
            nx, ny = self.rotate_direction(dx, dy, angle)
            adjusted_dirs.append((nx, ny))

        available_squares = []
        for dx, dy in adjusted_dirs:
            nx, ny = x + dx, y + dy
            if is_valid_position(nx, ny):
                available_squares.append((nx, ny))
        return available_squares

    def rotate_direction(self, dx, dy, angle):
        angle_rad = math.radians(angle)
        cos_theta = round(math.cos(angle_rad))
        sin_theta = round(math.sin(angle_rad))
        nx = cos_theta * dx - sin_theta * dy
        ny = sin_theta * dx + cos_theta * dy
        return int(nx), int(ny)

def draw_board():
    # Blit the board image onto the screen
    screen.blit(board_image, (0, 0))

def draw_highlight(highlight_squares, color):
    for x, y in highlight_squares:
        s = pygame.Surface((SQUARE_SIZE, SQUARE_SIZE), pygame.SRCALPHA)
        s.fill(color)
        screen.blit(s, (x * SQUARE_SIZE, y * SQUARE_SIZE))

def draw_pieces():
    for piece in pieces:
        piece.draw()

def draw_buttons():
    pygame.draw.rect(screen, DARK_YELLOW if rotate_mode else DARK_RED, rotate_button)
    font = pygame.font.Font(None, 24)
    rotate_text = font.render("Rotate", True, BLACK)
    rotate_rect = rotate_text.get_rect(center=rotate_button.center)
    screen.blit(rotate_text, rotate_rect)
    if rotate_mode:
        pygame.draw.rect(screen, DARK_GREEN, done_button)
        pygame.draw.rect(screen, DARK_RED, cancel_button)
        done_text = font.render("Done", True, BLACK)
        cancel_text = font.render("Cancel", True, BLACK)
        done_rect = done_text.get_rect(center=done_button.center)
        cancel_rect = cancel_text.get_rect(center=cancel_button.center)
        screen.blit(done_text, done_rect)
        screen.blit(cancel_text, cancel_rect)

def get_square_under_mouse(pos):
    x, y = pos
    return (x // SQUARE_SIZE, y // SQUARE_SIZE)

def is_valid_position(x, y):
    return 0 <= x < BOARD_WIDTH and 0 <= y < BOARD_HEIGHT

def swap_pieces(piece1, piece2):
    board[piece1.y][piece1.x], board[piece2.y][piece2.x] = piece2, piece1
    piece1.x, piece2.x = piece2.x, piece1.x
    piece1.y, piece2.y = piece2.y, piece1.y

# Initialize pieces
pieces = [
    Piece(0, 7, "DP", player=1), Piece(1, 7, "DT", player=1), Piece(2, 7, "DN", player=1),
    Piece(3, 7, "C", player=1), Piece(4, 7, "DN", player=1), Piece(5, 7, "DT", player=1),
    Piece(6, 7, "DP", player=1),
    Piece(0, 6, "PR", player=1), Piece(1, 6, "PL", player=1), Piece(2, 6, "PR", player=1),
    Piece(3, 6, "PX", player=1), Piece(4, 6, "PL", player=1), Piece(5, 6, "PR", player=1),
    Piece(6, 6, "PL", player=1),

    Piece(0, 0, "DPe", player=2, flipped=True), Piece(1, 0, "DTe", player=2, flipped=True),
    Piece(2, 0, "DNe", player=2, flipped=True), Piece(3, 0, "Ce", player=2, flipped=True),
    Piece(4, 0, "DNe", player=2, flipped=True), Piece(5, 0, "DTe", player=2, flipped=True),
    Piece(6, 0, "DPe", player=2, flipped=True),
    Piece(0, 1, "PLe", player=2, flipped=True), Piece(1, 1, "PRe", player=2, flipped=True),
    Piece(2, 1, "PLe", player=2, flipped=True), Piece(3, 1, "PXe", player=2, flipped=True),
    Piece(4, 1, "PRe", player=2, flipped=True), Piece(5, 1, "PLe", player=2, flipped=True),
    Piece(6, 1, "PRe", player=2, flipped=True)
]

# Place pieces on the board
for piece in pieces:
    if is_valid_position(piece.x, piece.y):
        board[piece.y][piece.x] = piece
    else:
        print(f"Invalid initial position for piece: {piece.type} at ({piece.x}, {piece.y})")
        sys.exit()

# Initialize game state variables
selected_piece = None
highlighted_positions = set()
empty_accessible_squares = set()
occupied_accessible_squares = set()
rotate_mode = False
current_player = 1  
rotation_chances = 2
player_scores = {1: 0, 2: 0}
game_over = False

# Define button dimensions and positions
button_width = min(150, (SCREEN_WIDTH - 30) // 2)
button_height = 50
rotate_button = pygame.Rect(
    SCREEN_WIDTH // 2 - button_width // 2,
    BOARD_HEIGHT * SQUARE_SIZE + 25,
    button_width,
    button_height
)
done_button = pygame.Rect(
    SCREEN_WIDTH // 2 - button_width - 10,
    BOARD_HEIGHT * SQUARE_SIZE + 80,
    button_width,
    button_height
)
cancel_button = pygame.Rect(
    SCREEN_WIDTH // 2 + 10,
    BOARD_HEIGHT * SQUARE_SIZE + 80,
    button_width,
    button_height
)

def get_all_accessible_squares(piece, origin_piece, visited_positions=None, visited_pieces=None):
    if visited_positions is None:
        visited_positions = set()
    if visited_pieces is None:
        visited_pieces = set()

    accessible_squares = set()
    visited_pieces.add((piece.x, piece.y))

    available_squares = piece.get_available_squares()
    pieces_on_available = []

    for nx, ny in available_squares:
        if is_valid_position(nx, ny):
            target_piece = board[ny][nx]
            if target_piece != 0:
                accessible_squares.add((nx, ny))
                pieces_on_available.append(target_piece)

    for target_piece in pieces_on_available:
        if target_piece.player == piece.player and (target_piece.x, target_piece.y) not in visited_pieces:
            if (target_piece.x, target_piece.y) != (origin_piece.x, origin_piece.y):
                new_squares, visited_positions, visited_pieces = get_all_accessible_squares(
                    target_piece, origin_piece, visited_positions, visited_pieces
                )
                accessible_squares.update(new_squares)
        elif target_piece.player != piece.player:
            accessible_squares.add((target_piece.x, target_piece.y))

    for target_piece in pieces_on_available:
        if target_piece.player == piece.player:
            if (target_piece.x, target_piece.y) != (origin_piece.x, origin_piece.y):
                target_available_squares = target_piece.get_available_squares()
                for tx, ty in target_available_squares:
                    if is_valid_position(tx, ty) and (tx, ty) not in visited_positions:
                        visited_positions.add((tx, ty))
                        if board[ty][tx] == 0:
                            accessible_squares.add((tx, ty))
                        else:
                            accessible_squares.add((tx, ty))
    return accessible_squares, visited_positions, visited_pieces

def end_turn():
    global current_player, rotation_chances
    current_player = 2 if current_player == 1 else 1
    rotation_chances = 2

    for piece in pieces:
        if piece.player == current_player:
            piece.moved_last_turn = False
            piece.rotated_this_turn = False
        else:
            if piece.moved_last_turn:
                piece.moved_last_turn = False  

# Main game loop
running = True
while running:
    if game_over:
        font = pygame.font.Font(None, 72)
        if player_scores[1] >= 5 and player_scores[2] >= 5:
            text = "Draw!"
        elif player_scores[1] >= 5:
            text = "Player 1 Wins!"
        elif player_scores[2] >= 5:
            text = "Player 2 Wins!"
        else:
            text = ""
        if text != "":
            text_surface = font.render(text, True, WHITE)
            text_rect = text_surface.get_rect(center=(SCREEN_WIDTH//2, SCREEN_HEIGHT//2))
            screen.blit(text_surface, text_rect)
            pygame.display.flip()
            pygame.time.wait(3000)
        running = False
        continue

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:  # Left click
                if rotate_mode:
                    if done_button.collidepoint(event.pos):
                        # Handle "Done" button click
                        rotation_chances -= 1
                        if selected_piece:
                            selected_piece.rotated_this_turn = True
                        rotate_mode = False
                        selected_piece = None
                        highlighted_positions = set()
                        empty_accessible_squares = set()
                        occupied_accessible_squares = set()

                    elif cancel_button.collidepoint(event.pos):
                        # Handle "Cancel" button click
                        rotate_mode = False

                        if selected_piece:
                            selected_piece.is_rotating = False
                            selected_piece.rotation = selected_piece.initial_rotation % 360
                            selected_piece.target_rotation = selected_piece.initial_rotation % 360
                            selected_piece.update_image()

                        if selected_piece:
                            accessible_squares, _, _ = get_all_accessible_squares(selected_piece, selected_piece)
                            highlighted_positions = accessible_squares
                            empty_accessible_squares = {(x, y) for x, y in highlighted_positions if board[y][x] == 0}
                            occupied_accessible_squares = highlighted_positions - empty_accessible_squares
                    else:
                        # Handle rotation of the selected piece
                        x, y = get_square_under_mouse(event.pos)
                        if (x, y) == (selected_piece.x, selected_piece.y) and selected_piece:
                            selected_piece.rotate()
                elif rotate_button.collidepoint(event.pos):
                    # Handle "Rotate" button click
                    if rotation_chances > 0:
                        if selected_piece and selected_piece.type.rstrip('e') in ['DP', 'DT', 'DN', 'C'] and selected_piece.player == current_player and not selected_piece.rotated_this_turn:
                            rotate_mode = True
                            highlighted_positions = set()
                            empty_accessible_squares = set()
                            occupied_accessible_squares = set()
                            selected_piece.initial_rotation = selected_piece.rotation % 360
                            selected_piece.target_rotation = selected_piece.rotation % 360
                            selected_piece.is_rotating = False
                        else:
                            rotate_mode = False
                    else:
                        rotate_mode = False
                else:
                    # Handle board square clicks
                    x, y = get_square_under_mouse(event.pos)
                    if is_valid_position(x, y):
                        clicked_piece = board[y][x]
                        if selected_piece is None:
                            if clicked_piece != 0 and clicked_piece.can_be_selected(current_player):
                                selected_piece = clicked_piece
                                accessible_squares, _, _ = get_all_accessible_squares(selected_piece, selected_piece)
                                highlighted_positions = accessible_squares
                                empty_accessible_squares = {(x, y) for x, y in highlighted_positions if board[y][x] == 0}
                                occupied_accessible_squares = highlighted_positions - empty_accessible_squares
                            else:
                                pass  # Clicking on an invalid square or opponent's piece
                        else:
                            if rotate_mode:
                                pass  # Ignore clicks when in rotate mode
                            else:
                                if (x, y) == (selected_piece.x, selected_piece.y):
                                    # Deselect the piece
                                    selected_piece = None
                                    highlighted_positions = set()
                                    empty_accessible_squares = set()
                                    occupied_accessible_squares = set()
                                elif (x, y) in highlighted_positions:
                                    target_piece = board[y][x]
                                    if target_piece == 0:
                                        # Move the piece to the empty square
                                        board[selected_piece.y][selected_piece.x] = 0
                                        selected_piece.x, selected_piece.y = x, y
                                        board[y][x] = selected_piece
                                        selected_piece.moved_last_turn = True

                                        # Handle promotion if applicable
                                        promotion_row = 0 if current_player == 1 else BOARD_HEIGHT - 1
                                        if selected_piece.type.rstrip('e') in ['PR', 'PL'] and selected_piece.y == promotion_row:
                                            board[selected_piece.y][selected_piece.x] = 0
                                            pieces.remove(selected_piece)
                                            player_scores[current_player] += 1

                                            if player_scores[current_player] >= 5:
                                                game_over = True
                                        selected_piece = None
                                        highlighted_positions = set()
                                        empty_accessible_squares = set()
                                        occupied_accessible_squares = set()
                                        end_turn()
                                    else:
                                        # Swap pieces
                                        swap_pieces(selected_piece, target_piece)
                                        selected_piece.moved_last_turn = True
                                        if target_piece.player != current_player:
                                            target_piece.moved_last_turn = True

                                        # Handle promotion if applicable
                                        promotion_row = 0 if current_player == 1 else BOARD_HEIGHT - 1
                                        if selected_piece.type.rstrip('e') in ['PR', 'PL'] and selected_piece.y == promotion_row:
                                            board[selected_piece.y][selected_piece.x] = 0
                                            pieces.remove(selected_piece)
                                            player_scores[current_player] += 1

                                            if player_scores[current_player] >= 5:
                                                game_over = True

                                        selected_piece = None
                                        highlighted_positions = set()
                                        empty_accessible_squares = set()
                                        occupied_accessible_squares = set()
                                        end_turn()
                                else:
                                    pass  # Clicked outside accessible squares
            elif event.button == 3:  # Right click
                if rotate_mode:
                    # Cancel rotation mode on right click
                    rotate_mode = False

                    if selected_piece:
                        selected_piece.is_rotating = False
                        selected_piece.rotation = selected_piece.initial_rotation % 360
                        selected_piece.target_rotation = selected_piece.initial_rotation % 360
                        selected_piece.update_image()

                    if selected_piece:
                        accessible_squares, _, _ = get_all_accessible_squares(selected_piece, selected_piece)
                        highlighted_positions = accessible_squares
                        empty_accessible_squares = {(x, y) for x, y in highlighted_positions if board[y][x] == 0}
                        occupied_accessible_squares = highlighted_positions - empty_accessible_squares
                else:
                    # Deselect any selected piece on right click
                    selected_piece = None
                    highlighted_positions = set()
                    empty_accessible_squares = set()
                    occupied_accessible_squares = set()

    # Update rotation for all pieces
    for piece in pieces:
        piece.update()

    # Clear screen by filling it with black (optional since we are blitting the board)
    screen.fill(BLACK)

    # Draw the board (background)
    draw_board()

    # Draw highlights above the board
    if highlighted_positions:
        if not rotate_mode:
            draw_highlight(empty_accessible_squares, ORANGE_EMPTY)
            draw_highlight(occupied_accessible_squares, PURPLE_OCCUPIED)

    # Highlight the selected piece
    if selected_piece:
        draw_highlight([(selected_piece.x, selected_piece.y)], SELECTED_HIGHLIGHT)

    # Draw all pieces above the highlights
    draw_pieces()

    # Draw buttons above everything
    draw_buttons()

    # Draw the score and turn information
    font = pygame.font.Font(None, 36)
    score_text = f"Player 1: {player_scores[1]}    Player 2: {player_scores[2]}"
    score_surface = font.render(score_text, True, WHITE)
    screen.blit(score_surface, (10, SCREEN_HEIGHT - 130))

    turn_text = f"Player {current_player}'s turn"
    turn_surface = font.render(turn_text, True, WHITE)
    screen.blit(turn_surface, (SCREEN_WIDTH - 200, SCREEN_HEIGHT - 130))

    rotation_text = f"Rotations left: {rotation_chances}"
    rotation_surface = font.render(rotation_text, True, WHITE)
    screen.blit(rotation_surface, (SCREEN_WIDTH - 200, SCREEN_HEIGHT - 100))

    # Update the display
    pygame.display.flip()

pygame.quit()
sys.exit()