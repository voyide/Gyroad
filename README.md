#BASIC INFO

This is gyroad, 2 player game, 14 piece each player (see them before reading further).

Only bottom row pieces can be rotated (at most 2 times each turn).

When your PR or PL piece reaches the other side of the board it gets removed and you get 1 point.

First player to reach 5 points wins, draw if both reaches together.




#PIECES INFO

Each piece has its own set of "available_square". For "PR" its the square to its left or (x-1,y)
and the square diagonally up to the right or (x+1,y+1). The pieces are designed in a way to point
to their "available_squares". "DN" piece is a special case, for it (x-1,y) and (x+1,y) are 
inaccessible, this is shown by coloring the points red in its design.

#MOVEMENT INFO [IMPORTANT]
You CAN'T move a selected piece directly to its "available_squares".
•  Let selected piece be S, if another friendly piece T is at its "available_square" 
   then you can either:'switch their positions' or move S to any of the T's "available_squares".
•  If there is another friendly piece U at any of T's "available_squares" you can: 
   'switch S and U' or move S to any of the U's "available_squares".
•  This continues for all of the friendly pieces forming a link or chain of "available_squares"
   for S to move or exchange.
•  You can't move S to any of the "available_squares" of an enemy piece, but you can switch their
   positions.


#GAMEPLAY INFO
•  If you 'move' or 'switch your piece with any other piece' your turn ends.
•  In each turn you have 2 rotations, which you may use without losing your turn.
•  A piece rotated once cannot be rotated again in the same turn.
