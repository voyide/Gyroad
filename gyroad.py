import pygame
import sys
import math
import os
from collections import deque

# Detect web runtime (pygbag/pygame-web)
IS_WEB = sys.platform == "emscripten"

# Optional GIF loader (no PIL). Disable on web to avoid heavy deps.
try:
    if IS_WEB:
        raise ImportError("Disable imageio on web (use frames fallback)")
    import imageio.v2 as imageio
except Exception:
    imageio = None

pygame.init()

# Board constants
BOARD_WIDTH = 7
BOARD_HEIGHT = 8

def pick_canvas_size():
    # Browser: display.Info() may report zeros before set_mode
    if IS_WEB:
        w = int(os.environ.get("PYGAME_WEB_WIDTH", "840"))
        h = int(os.environ.get("PYGAME_WEB_HEIGHT", "900"))
        return max(w, 560), max(h, 750)
    info = pygame.display.Info()
    w = info.current_w or 1280
    h = info.current_h or 800
    return w, h

cw, ch = pick_canvas_size()

SQUARE_SIZE = max(48, min(cw // BOARD_WIDTH, (ch - 150) // BOARD_HEIGHT))
SCREEN_WIDTH = SQUARE_SIZE * BOARD_WIDTH
SCREEN_HEIGHT = SQUARE_SIZE * BOARD_HEIGHT + 150

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GRAY = (128, 128, 128)
DARK_GREEN = (0, 128, 0)
DARK_RED = (128, 0, 0)
YELLOW = (255, 255, 0)
DARK_YELLOW = (128, 128, 0)

flags = pygame.SCALED if IS_WEB else 0
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT), flags)
pygame.display.set_caption("Gyroad")

# Reduce event queue churn (we don't use mouse motion)
pygame.event.set_blocked(pygame.MOUSEMOTION)

try:
    board_image_raw = pygame.image.load('assets/board/B.jpeg').convert()
except pygame.error:
    print("Error loading board image. Please ensure 'assets/board/B.jpeg' exists.")
    sys.exit()

board_image = pygame.transform.scale(board_image_raw, (SQUARE_SIZE * BOARD_WIDTH, SQUARE_SIZE * BOARD_HEIGHT))

board = [[0 for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]

# Load base images
IMAGES = {}
for piece_type in ['PR', 'PL', 'PX', 'DP', 'DT', 'DN', 'C']:
    try:
        original_image = pygame.image.load(f'assets/sprites/{piece_type}.png').convert_alpha()
    except pygame.error:
        print(f"Error loading image for piece type: {piece_type}. Please ensure the file exists.")
        sys.exit()
    IMAGES[piece_type] = pygame.transform.scale(original_image, (SQUARE_SIZE, SQUARE_SIZE))

    enemy_piece_type = piece_type + 'e'
    try:
        enemy_image = pygame.image.load(f'assets/sprites/{enemy_piece_type}.png').convert_alpha()
    except pygame.error:
        print(f"Error loading image for enemy piece type: {enemy_piece_type}. Please ensure the file exists.")
        sys.exit()
    IMAGES[enemy_piece_type] = pygame.transform.scale(enemy_image, (SQUARE_SIZE, SQUARE_SIZE))

    IMAGES[piece_type + '_flipped'] = pygame.transform.rotate(IMAGES[piece_type], 180)
    IMAGES[enemy_piece_type + '_flipped'] = pygame.transform.rotate(IMAGES[enemy_piece_type], 180)

try:
    select_highlight_img_raw = pygame.image.load('assets/board/selecth.png').convert()
    empty_highlight_img_raw = pygame.image.load('assets/board/emptyh.png').convert()
    swap_highlight_img_raw = pygame.image.load('assets/board/swaph.png').convert()
except pygame.error as e:
    print(f"Error loading highlight images: {e}")
    sys.exit()

select_highlight_img = pygame.transform.scale(select_highlight_img_raw, (SQUARE_SIZE, SQUARE_SIZE))
empty_highlight_img = pygame.transform.scale(empty_highlight_img_raw, (SQUARE_SIZE, SQUARE_SIZE))
swap_highlight_img = pygame.transform.scale(swap_highlight_img_raw, (SQUARE_SIZE, SQUARE_SIZE))

# Fonts and pre-rendered static UI text
FONT_SM = pygame.font.Font(None, 24)
FONT_MD = pygame.font.Font(None, 36)

UI_TEXT = {
    'rotate': FONT_SM.render("Rotate", True, BLACK),
    'done':   FONT_SM.render("Done", True, BLACK),
    'cancel': FONT_SM.render("Cancel", True, BLACK),
}

# Dynamic UI text cache
last_score_text = ""
score_surface = FONT_MD.render("Player 1: 0    Player 2: 0", True, WHITE)

last_turn_text = ""
turn_surface = FONT_MD.render("Player 1's turn", True, WHITE)

last_rotation_text = ""
rotation_surface = FONT_MD.render("Rotations left: 2", True, WHITE)

def ease_in_out_cubic(t):
    if t < 0.5:
        return 4 * t * t * t
    else:
        return 1 - pow(-2 * t + 2, 3) / 2

def load_shine_animation(square_size):
    # Primary: use imageio to read GIF (no PIL). On web imageio is disabled above.
    if imageio is not None:
        try:
            reader = imageio.get_reader('assets/Gif/Sh.gif')
            meta = {}
            try:
                meta = reader.get_meta_data()
            except Exception:
                meta = {}
            frames = []
            durations = []
            index = 0
            for frame in reader:
                h, w = frame.shape[:2]
                has_alpha = frame.shape[2] == 4 if len(frame.shape) == 3 else False
                surf = pygame.image.frombuffer(frame.tobytes(), (w, h), 'RGBA' if has_alpha else 'RGB')
                surf = surf.convert_alpha() if has_alpha else surf.convert()
                surf = pygame.transform.scale(surf, (square_size, square_size))
                frames.append(surf)
                # per-frame duration, fallback to GIF-level duration or 100ms
                d = None
                try:
                    frame_meta = reader.get_meta_data(index=index)
                    d = frame_meta.get('duration', None)
                except Exception:
                    d = meta.get('duration', None)
                if not d or d == 0:
                    d = 0.1  # seconds fallback
                durations.append(int(d if d > 10 else d * 1000))
                index += 1
            reader.close()
            if frames:
                return frames, durations
            else:
                print("imageio: GIF loaded but contained no frames.")
        except Exception as e:
            print(f"imageio failed to load 'assets/Gif/Sh.gif': {e}. Trying frame folder fallback...")

    # Fallback: load frames from a directory
    frames_dir = 'assets/Gif/Sh_frames'
    if os.path.isdir(frames_dir):
        files = [f for f in os.listdir(frames_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        files.sort()
        frames = []
        durations = []
        for fname in files:
            path = os.path.join(frames_dir, fname)
            try:
                img = pygame.image.load(path).convert_alpha()
            except Exception:
                img = pygame.image.load(path).convert()
            img = pygame.transform.scale(img, (square_size, square_size))
            frames.append(img)
            durations.append(100)  # default 100ms
        # Optional durations.txt (ms per line)
        dur_path = os.path.join(frames_dir, 'durations.txt')
        if frames and os.path.exists(dur_path):
            try:
                with open(dur_path, 'r') as f:
                    durs = [int(x.strip()) for x in f if x.strip()]
                if len(durs) == len(frames):
                    durations = durs
            except Exception:
                pass
        if frames:
            return frames, durations

    print("Shine animation not available (no PIL, imageio failed, and no frame folder). Animation disabled.")
    return [], []

shine_frames, shine_durations = load_shine_animation(SQUARE_SIZE)

shine_animation = {
    'frames': shine_frames,
    'durations': shine_durations,
    'frame_count': len(shine_frames),
}

shine_current_frame = 0
shine_last_update_time = pygame.time.get_ticks()
shine_animation_playing = False

# Precompute sprite rotations at 15-degree increments
ROT_ANGLE_STEP = 15
ROT_ANGLES = [i * ROT_ANGLE_STEP for i in range(360 // ROT_ANGLE_STEP)]

ROTATED_CACHE = {}
for key, base_img in list(IMAGES.items()):
    # Note: IMAGES is being updated in-place below, so iterate on a snapshot
    ROTATED_CACHE[key] = {angle: pygame.transform.rotate(base_img, angle) for angle in ROT_ANGLES}
# Also include flipped versions that were added to IMAGES earlier
for key, base_img in IMAGES.items():
    if key not in ROTATED_CACHE:
        ROTATED_CACHE[key] = {angle: pygame.transform.rotate(base_img, angle) for angle in ROT_ANGLES}

def draw_highlight(highlight_squares, highlight_type):
    for x, y in highlight_squares:
        if highlight_type == 'select':
            highlight_img = select_highlight_img
        elif highlight_type == 'empty':
            highlight_img = empty_highlight_img
        elif highlight_type == 'swap':
            highlight_img = swap_highlight_img
        else:
            continue
        screen.blit(highlight_img, (x * SQUARE_SIZE, y * SQUARE_SIZE))

def draw_board():
    screen.blit(board_image, (0, 0))

def draw_pieces():
    for piece in pieces:
        piece.draw()

def draw_buttons():
    pygame.draw.rect(screen, DARK_YELLOW if rotate_mode else DARK_RED, rotate_button)
    rotate_rect = UI_TEXT['rotate'].get_rect(center=rotate_button.center)
    screen.blit(UI_TEXT['rotate'], rotate_rect)
    if rotate_mode:
        pygame.draw.rect(screen, DARK_GREEN, done_button)
        pygame.draw.rect(screen, DARK_RED, cancel_button)
        done_rect = UI_TEXT['done'].get_rect(center=done_button.center)
        cancel_rect = UI_TEXT['cancel'].get_rect(center=cancel_button.center)
        screen.blit(UI_TEXT['done'], done_rect)
        screen.blit(UI_TEXT['cancel'], cancel_rect)

def get_square_under_mouse(pos):
    x, y = pos
    return (x // SQUARE_SIZE, y // SQUARE_SIZE)

def is_valid_position(x, y):
    return 0 <= x < BOARD_WIDTH and 0 <= y < BOARD_HEIGHT

def swap_pieces_func(piece1, piece2):
    board[piece1.y][piece1.x], board[piece2.y][piece2.x] = piece2, piece1
    piece1.x, piece2.x = piece2.x, piece1.x
    piece1.y, piece2.y = piece2.y, piece1.y

class Piece:
    def __init__(self, x, y, piece_type, player, flipped=False):
        self.x = x
        self.y = y
        self.type = piece_type
        self.player = player
        self.flipped = flipped
        self.initial_rotation = 0
        self.target_rotation = 0
        self.rotation = 0
        self.rotation_speed = 15  # degrees per update
        self.is_rotating = False
        self.relative_dirs_cache = {}  # cache of rotated direction deltas per angle
        self.update_image()
        self.moved_last_turn = False
        self.rotated_this_turn = False

        self.movement_path = []
        self.is_moving = False
        self.current_segment_index = 0
        self.move_speed = 300
        self.draw_position = ((self.x + 0.5) * SQUARE_SIZE, (self.y + 0.5) * SQUARE_SIZE)
        self.movement_total_time = None
        self.movement_elapsed_time = 0

    def update_image(self):
        key = self.type + ('_flipped' if self.flipped else '')
        angle = int(self.rotation) % 360  # rotation is multiples of 15
        base = ROTATED_CACHE.get(key, None)
        if base and angle in base:
            self.image = base[angle]
        else:
            print(f"Rotated image not found for key '{key}' angle {angle}.")
            sys.exit()

    def draw(self):
        rect = self.image.get_rect(center=self.draw_position)
        screen.blit(self.image, rect)

    def rotate(self):
        self.is_rotating = True
        self.target_rotation = (self.target_rotation - 90) % 360

    def update(self, dt):
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

        if self.is_moving:
            if self.current_segment_index < len(self.movement_path) - 1:
                start_pos = self.movement_path[self.current_segment_index]
                end_pos = self.movement_path[self.current_segment_index + 1]

                start_pixel_x = start_pos[0] * SQUARE_SIZE + SQUARE_SIZE / 2
                start_pixel_y = start_pos[1] * SQUARE_SIZE + SQUARE_SIZE / 2
                end_pixel_x = end_pos[0] * SQUARE_SIZE + SQUARE_SIZE / 2
                end_pixel_y = end_pos[1] * SQUARE_SIZE + SQUARE_SIZE / 2

                dx = end_pixel_x - start_pixel_x
                dy = end_pixel_y - start_pixel_y
                distance = math.hypot(dx, dy)

                if self.movement_total_time is None:
                    self.movement_total_time = distance / self.move_speed
                    self.movement_elapsed_time = 0

                self.movement_elapsed_time += dt

                t = min(self.movement_elapsed_time / self.movement_total_time, 1)
                eased_t = ease_in_out_cubic(t)

                move_x = start_pixel_x + dx * eased_t
                move_y = start_pixel_y + dy * eased_t
                self.draw_position = (move_x, move_y)

                if t >= 1:
                    self.current_segment_index += 1
                    self.movement_elapsed_time = 0
                    self.movement_total_time = None
            else:
                self.is_moving = False
                self.x, self.y = self.movement_path[-1]
                self.draw_position = ((self.x + 0.5) * SQUARE_SIZE, (self.y + 0.5) * SQUARE_SIZE)
                self.movement_path = []
                self.current_segment_index = 0
                self.movement_total_time = None
                self.movement_elapsed_time = 0

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
        t = self.type.rstrip('e')
        if t == 'PR':
            dirs = [left, (right[0], right[1] + down[1])]
        elif t == 'PL':
            dirs = [right, (left[0], left[1] + down[1])]
        elif t == 'PX':
            dirs = [
                (right[0] + up[0], right[1] + up[1]),
                (right[0] + down[0], right[1] + down[1]),
                (left[0] + up[0], left[1] + up[1]),
                (left[0] + down[0], left[1] + down[1]),
            ]
        elif t == 'DP':
            dirs = [up, (up[0]*2, up[1]*2), left, right]
        elif t == 'DT':
            dirs = [up, (up[0]+left[0], up[1]+left[1]), (up[0]+right[0], up[1]+right[1]), down]
        elif t == 'DN':
            dirs = [up, down, (left[0]*2, left[1]*2), (right[0]*2, right[1]*2)]
        elif t == 'C':
            dirs = [up, (down[0]+left[0], down[1]+left[1]), (down[0]+right[0], down[1]+right[1])]

        adjusted_dirs = []
        angle = (-rotation) % 360
        if angle not in self.relative_dirs_cache:
            for dx, dy in dirs:
                nx, ny = self.rotate_direction(dx, dy, angle)
                adjusted_dirs.append((nx, ny))
            self.relative_dirs_cache[angle] = adjusted_dirs
        else:
            adjusted_dirs = self.relative_dirs_cache[angle]

        available_squares = []
        for dx, dy in adjusted_dirs:
            nx, ny = x + dx, y + dy
            if is_valid_position(nx, ny):
                available_squares.append((nx, ny))
        return available_squares

    def rotate_direction(self, dx, dy, angle):
        a = angle % 360
        if a == 0:
            return dx, dy
        elif a == 90:
            return -dy, dx
        elif a == 180:
            return -dx, -dy
        elif a == 270:
            return dy, -dx
        else:
            # Safe fallback (should not be used; rotations are 90° steps for logic)
            angle_rad = math.radians(a)
            cos_theta = round(math.cos(angle_rad))
            sin_theta = round(math.sin(angle_rad))
            nx = cos_theta * dx - sin_theta * dy
            ny = sin_theta * dx + cos_theta * dy
            return int(nx), int(ny)

def get_accessible_highlight_layers(selected_piece):
    layers = []
    visited_pieces = set()
    visited_positions = set()

    current_layer_pieces = {selected_piece}
    visited_pieces.add(selected_piece)

    while current_layer_pieces:
        empty_layer = set()
        occupied_layer = set()
        next_layer_pieces = set()

        for piece in current_layer_pieces:

            if piece == selected_piece:
                check = piece.get_available_squares()
                available_squares = []

                for x, y in check:
                    if is_valid_position(x, y) and board[y][x] != 0:
                        available_squares.append((x, y))

            else:
                available_squares = piece.get_available_squares()

            for x, y in available_squares:
                if not is_valid_position(x, y):
                    continue

                if (x, y) in visited_positions:
                    continue

                target_piece = board[y][x]

                if target_piece == 0:
                    empty_layer.add((x, y))
                else:
                    occupied_layer.add((x, y))
                    if target_piece.player == selected_piece.player and target_piece not in visited_pieces:
                        next_layer_pieces.add(target_piece)
                        visited_pieces.add(target_piece)

        if empty_layer or occupied_layer:
            layers.append((empty_layer, occupied_layer))

        for empty in empty_layer:
            visited_positions.add(empty)

        for occupied in occupied_layer:
            visited_positions.add(occupied)

        current_layer_pieces = next_layer_pieces

    return layers

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

def end_turn_func():
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

def find_movement_path(selected_piece, destination):
    accessible_pieces = set()
    _, _, visited_pieces = get_all_accessible_squares(selected_piece, selected_piece)
    for x, y in visited_pieces:
        piece = board[y][x]
        if piece != 0 and piece.player == selected_piece.player:
            accessible_pieces.add(piece)

    if board[destination[1]][destination[0]] == 0:
        accessible_pieces_first_step = accessible_pieces - {selected_piece}
    else:
        accessible_pieces_first_step = accessible_pieces

    queue = deque()
    queue.append((destination, [destination]))
    visited_positions = set()
    visited_positions.add(destination)

    while queue:
        current_pos, path = queue.popleft()
        if current_pos == (selected_piece.x, selected_piece.y):
            return path[::-1]

        if len(path) == 1:
            pieces_to_consider = accessible_pieces_first_step
        else:
            pieces_to_consider = accessible_pieces

        for piece in pieces_to_consider:
            if current_pos in piece.get_available_squares():
                piece_pos = (piece.x, piece.y)
                if piece_pos not in visited_positions:
                    visited_positions.add(piece_pos)
                    queue.append((piece_pos, path + [piece_pos]))

    return None

# Pieces
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

for piece in pieces:
    if is_valid_position(piece.x, piece.y):
        board[piece.y][piece.x] = piece
    else:
        print(f"Invalid initial position for piece: {piece.type} at ({piece.x}, {piece.y})")
        sys.exit()

selected_piece = None
highlighted_positions = set()
empty_accessible_squares = set()
occupied_accessible_squares = set()
rotate_mode = False
current_player = 1
rotation_chances = 2
player_scores = {1: 0, 2: 0}
game_over = False

accessible_highlight_layers = []
current_highlight_layer = 0
last_layer_update_time = 0
layer_delay = 80
highlighting_in_progress = False

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

clock = pygame.time.Clock()
pieces_are_animating = False

while True:
    dt = clock.tick(60) / 1000.0  # one dt for all updates

    if game_over:
        font = pygame.font.Font(None, 72)
        if player_scores[1] >= 6 and player_scores[2] >= 6:
            text = "Draw!"
        elif player_scores[1] >= 6:
            text = "Player 1 Wins!"
        elif player_scores[2] >= 6:
            text = "Player 2 Wins!"
        else:
            text = ""
        if text != "":
            text_surface = font.render(text, True, WHITE)
            text_rect = text_surface.get_rect(center=(SCREEN_WIDTH//2, SCREEN_HEIGHT//2))
            screen.blit(text_surface, text_rect)
            pygame.display.flip()
            pygame.time.wait(3000)
        break

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            pygame.quit()
            sys.exit()
        elif not pieces_are_animating:
            if event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if rotate_mode:
                        if done_button.collidepoint(event.pos):
                            rotation_chances -= 1
                            if selected_piece:
                                selected_piece.rotated_this_turn = True
                            rotate_mode = False
                            selected_piece = None
                            highlighted_positions = set()
                            empty_accessible_squares = set()
                            occupied_accessible_squares = set()
                            accessible_highlight_layers = []
                            current_highlight_layer = 0
                            highlighting_in_progress = False

                        elif cancel_button.collidepoint(event.pos):
                            rotate_mode = False

                            if selected_piece:
                                selected_piece.is_rotating = False
                                selected_piece.rotation = selected_piece.initial_rotation % 360
                                selected_piece.target_rotation = selected_piece.initial_rotation % 360
                                selected_piece.update_image()

                            if selected_piece:
                                accessible_highlight_layers = get_accessible_highlight_layers(selected_piece)
                                highlighted_positions = set()
                                empty_accessible_squares = set()
                                occupied_accessible_squares = set()
                                current_highlight_layer = 0
                                last_layer_update_time = pygame.time.get_ticks()
                                highlighting_in_progress = True
                        else:
                            x, y = get_square_under_mouse(event.pos)
                            if selected_piece and (x, y) == (selected_piece.x, selected_piece.y):
                                selected_piece.rotate()
                    elif rotate_button.collidepoint(event.pos):
                        if rotation_chances > 0:
                            if selected_piece and selected_piece.type.rstrip('e') in ['DP', 'DT', 'DN', 'C'] and selected_piece.player == current_player and not selected_piece.rotated_this_turn:
                                rotate_mode = True
                                highlighted_positions = set()
                                empty_accessible_squares = set()
                                occupied_accessible_squares = set()
                                accessible_highlight_layers = []
                                current_highlight_layer = 0
                                last_layer_update_time = 0
                                highlighting_in_progress = False
                                selected_piece.initial_rotation = selected_piece.rotation % 360
                                selected_piece.target_rotation = selected_piece.rotation % 360
                                selected_piece.is_rotating = False
                            else:
                                rotate_mode = False
                        else:
                            rotate_mode = False
                    else:
                        x, y = get_square_under_mouse(event.pos)
                        if is_valid_position(x, y):
                            clicked_piece = board[y][x]
                            if selected_piece is None:
                                if clicked_piece != 0 and clicked_piece.can_be_selected(current_player):
                                    selected_piece = clicked_piece

                                    shine_current_frame = 0
                                    shine_last_update_time = pygame.time.get_ticks()
                                    shine_animation_playing = True

                                    accessible_highlight_layers = get_accessible_highlight_layers(selected_piece)
                                    highlighted_positions = set()
                                    empty_accessible_squares = set()
                                    occupied_accessible_squares = set()
                                    current_highlight_layer = 0
                                    last_layer_update_time = pygame.time.get_ticks()
                                    highlighting_in_progress = True
                                else:
                                    pass
                            else:
                                if rotate_mode:
                                    pass
                                else:
                                    if (x, y) == (selected_piece.x, selected_piece.y):
                                        selected_piece = None
                                        highlighted_positions = set()
                                        empty_accessible_squares = set()
                                        occupied_accessible_squares = set()
                                        accessible_highlight_layers = []
                                        current_highlight_layer = 0
                                        highlighting_in_progress = False
                                    elif (x, y) in highlighted_positions:
                                        path = find_movement_path(selected_piece, (x, y))
                                        if path is None:
                                            pass
                                        else:
                                            target_piece = board[y][x]
                                            if target_piece == 0:
                                                selected_piece.movement_path = path
                                                selected_piece.is_moving = True
                                                selected_piece.current_segment_index = 0

                                                board[selected_piece.y][selected_piece.x] = 0

                                                animating_pieces = [selected_piece]
                                                pieces_are_animating = True
                                            else:
                                                selected_piece.movement_path = path
                                                selected_piece.is_moving = True
                                                selected_piece.current_segment_index = 0

                                                target_piece.movement_path = [(target_piece.x, target_piece.y), (selected_piece.x, selected_piece.y)]
                                                target_piece.is_moving = True
                                                target_piece.current_segment_index = 0

                                                board[selected_piece.y][selected_piece.x] = target_piece
                                                board[target_piece.y][target_piece.x] = 0

                                                animating_pieces = [selected_piece, target_piece]
                                                pieces_are_animating = True

                                            selected_piece = None
                                            highlighted_positions = set()
                                            empty_accessible_squares = set()
                                            occupied_accessible_squares = set()
                                            accessible_highlight_layers = []
                                            current_highlight_layer = 0
                                            highlighting_in_progress = False
                                    else:
                                        pass
                elif event.button == 3:
                    if rotate_mode:
                        rotate_mode = False

                        if selected_piece:
                            selected_piece.is_rotating = False
                            selected_piece.rotation = selected_piece.initial_rotation % 360
                            selected_piece.target_rotation = selected_piece.initial_rotation % 360
                            selected_piece.update_image()

                        if selected_piece:
                            accessible_highlight_layers = get_accessible_highlight_layers(selected_piece)
                            highlighted_positions = set()
                            empty_accessible_squares = set()
                            occupied_accessible_squares = set()
                            current_highlight_layer = 0
                            last_layer_update_time = pygame.time.get_ticks()
                            highlighting_in_progress = True
                    else:
                        selected_piece = None
                        highlighted_positions = set()
                        empty_accessible_squares = set()
                        occupied_accessible_squares = set()
                        accessible_highlight_layers = []
                        current_highlight_layer = 0
                        highlighting_in_progress = False

    for piece in pieces:
        piece.update(dt)

    if highlighting_in_progress and current_highlight_layer < len(accessible_highlight_layers):
        current_time = pygame.time.get_ticks()
        if current_time - last_layer_update_time >= layer_delay:
            empty_layer, occupied_layer = accessible_highlight_layers[current_highlight_layer]
            empty_accessible_squares.update(empty_layer)
            occupied_accessible_squares.update(occupied_layer)
            highlighted_positions.update(empty_layer)
            highlighted_positions.update(occupied_layer)
            current_highlight_layer += 1
            last_layer_update_time = current_time

        if current_highlight_layer >= len(accessible_highlight_layers):
            highlighting_in_progress = False

    if pieces_are_animating:
        if all(not piece.is_moving for piece in animating_pieces):
            pieces_are_animating = False
            animating_pieces = []

            board = [[0 for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]
            for piece in pieces:
                board[piece.y][piece.x] = piece

            for piece in pieces.copy():
                promotion_row = 0 if piece.player == 1 else BOARD_HEIGHT - 1
                if piece.type.rstrip('e') in ['PR', 'PL'] and piece.y == promotion_row:
                    board[piece.y][piece.x] = 0
                    pieces.remove(piece)
                    player_scores[piece.player] += 1

                    if player_scores[piece.player] >= 6:
                        game_over = True

            end_turn_func()

    screen.fill(BLACK)
    draw_board()

    if highlighted_positions and not rotate_mode:
        draw_highlight(empty_accessible_squares, 'empty')
        draw_highlight(occupied_accessible_squares, 'swap')

    if selected_piece:
        draw_highlight([(selected_piece.x, selected_piece.y)], 'select')

    draw_pieces()

    if selected_piece and shine_animation['frame_count'] > 0:
        if shine_animation_playing:
            current_time = pygame.time.get_ticks()
            elapsed_time = current_time - shine_last_update_time
            frame_duration = shine_animation['durations'][shine_current_frame]

            if elapsed_time >= frame_duration:
                shine_current_frame += 1
                shine_last_update_time = current_time

                if shine_current_frame >= shine_animation['frame_count']:
                    shine_animation_playing = False
                    shine_current_frame = 0

            if shine_animation_playing:
                shine_frame = shine_animation['frames'][shine_current_frame]
                shine_rect = shine_frame.get_rect()
                shine_rect.topleft = (selected_piece.x * SQUARE_SIZE, selected_piece.y * SQUARE_SIZE)
                screen.blit(shine_frame, shine_rect)

    draw_buttons()

    # Update dynamic UI text only when it changes
    new_score_text = f"Player 1: {player_scores[1]}    Player 2: {player_scores[2]}"
    if new_score_text != last_score_text:
        last_score_text = new_score_text
        score_surface = FONT_MD.render(new_score_text, True, WHITE)

    new_turn_text = f"Player {current_player}'s turn"
    if new_turn_text != last_turn_text:
        last_turn_text = new_turn_text
        turn_surface = FONT_MD.render(new_turn_text, True, WHITE)

    new_rotation_text = f"Rotations left: {rotation_chances}"
    if new_rotation_text != last_rotation_text:
        last_rotation_text = new_rotation_text
        rotation_surface = FONT_MD.render(new_rotation_text, True, WHITE)

    screen.blit(score_surface, (10, SCREEN_HEIGHT - 130))
    screen.blit(turn_surface, (SCREEN_WIDTH - 200, SCREEN_HEIGHT - 130))
    screen.blit(rotation_surface, (SCREEN_WIDTH - 200, SCREEN_HEIGHT - 100))

    pygame.display.flip()

pygame.quit()
sys.exit()
