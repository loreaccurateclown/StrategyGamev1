import type {GridPos, ReachableTile} from "../types/game.types"

type TerrainCostFn = (tileIndex: number) => number;
type IsOccupiedFn = (pos: GridPos) => boolean;

// 4-directional movement. Order is clockwise from north purely so the search
// expands deterministically; it does not affect which costs are found.
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

export function tileKey(pos: GridPos): string {
    return `${pos.x},${pos.y}`;
}

function inBounds(grid: number[][], pos: GridPos): boolean {
    if (pos.y < 0 || pos.y >= grid.length) return false;
    const row = grid[pos.y];
    return row !== undefined && pos.x >= 0 && pos.x < row.length;
}

/** Minimal binary min-heap ordered by accumulated enter-cost. */
class MinHeap {
    private items: ReachableTile[] = [];

    get size(): number {
        return this.items.length;
    }

    push(tile: ReachableTile): void {
        this.items.push(tile);
        let child = this.items.length - 1;
        while (child > 0) {
            const parent = (child - 1) >> 1;
            if (this.items[parent].cost <= this.items[child].cost) break;
            [this.items[parent], this.items[child]] = [this.items[child], this.items[parent]];
            child = parent;
        }
    }

    pop(): ReachableTile | undefined {
        const top = this.items[0];
        if (top === undefined) return undefined;

        const last = this.items.pop() as ReachableTile;
        if (this.items.length === 0) return top;

        this.items[0] = last;
        let parent = 0;
        for (;;) {
            const left = parent * 2 + 1;
            const right = left + 1;
            let smallest = parent;

            if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) {
                smallest = left;
            }
            if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) {
                smallest = right;
            }
            if (smallest === parent) break;

            [this.items[parent], this.items[smallest]] = [this.items[smallest], this.items[parent]];
            parent = smallest;
        }
        return top;
    }
}

export function getReachableTiles(
    grid: number[][],
    start: GridPos,
    maxMovementPoints: number,
    getTerrainCost: TerrainCostFn,
    isOccupied: IsOccupiedFn,
): Map<string, ReachableTile> {
    const reachable = new Map<string, ReachableTile>();
    const startPos: GridPos = {x: start.x, y: start.y};

    // The start tile is always present and always free: a unit may end its turn
    // where it already stands, even when hemmed in.
    reachable.set(tileKey(startPos), {pos: startPos, cost: 0, parent: null});

    const frontier = new MinHeap();
    frontier.push({pos: startPos, cost: 0, parent: null});

    while (frontier.size > 0) {
        const current = frontier.pop() as ReachableTile;

        // A cheaper route to this tile may already have been settled.
        const settled = reachable.get(tileKey(current.pos));
        if (settled === undefined || current.cost > settled.cost) continue;

        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
            const next: GridPos = {x: current.pos.x + dx, y: current.pos.y + dy};

            if (!inBounds(grid, next)) continue;

            // The start tile is already settled at cost 0 and re-entering it can
            // never improve that, so skip it before consulting occupancy. This is
            // what guarantees isOccupied is never asked about the tile the moving
            // unit itself stands on — it must not block itself.
            if (next.x === startPos.x && next.y === startPos.y) continue;

            // Every other tile is checked; the predicate stands in for enemies.
            if (isOccupied(next)) continue;

            const stepCost = getTerrainCost(grid[next.y][next.x]);
            if (!Number.isFinite(stepCost) || stepCost < 0) continue;

            const nextCost = current.cost + stepCost;
            if (nextCost > maxMovementPoints) continue;

            const existing = reachable.get(tileKey(next));
            if (existing !== undefined && existing.cost <= nextCost) continue;

            const tile: ReachableTile = {pos: next, cost: nextCost, parent: current.pos};
            reachable.set(tileKey(next), tile);
            frontier.push(tile);
        }
    }

    return reachable;
}

export function reconstructPath(
    reachable: Map<string, ReachableTile>,
    target: GridPos,
): GridPos[] {
    let node = reachable.get(tileKey(target));
    if (node === undefined) return [];

    const reversed: GridPos[] = [];
    let guard = 0;

    while (node !== undefined) {
        reversed.push({x: node.pos.x, y: node.pos.y});
        if (node.parent === null) break;

        // Defensive: a corrupt parent chain must not spin forever.
        if (++guard > reachable.size) break;
        node = reachable.get(tileKey(node.parent));
    }

    return reversed.reverse();
}
