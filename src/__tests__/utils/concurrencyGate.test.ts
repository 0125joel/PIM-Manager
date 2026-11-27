import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "@/utils/concurrencyGate";

/** A task that ends when the test says so */
function task() {
    let finish!: (value: string) => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<string>((resolve, reject) => {
        finish = resolve;
        fail = reject;
    });
    return { promise, finish, fail };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createConcurrencyGate", () => {
    it("never runs more than max tasks at once", async () => {
        const gate = createConcurrencyGate(3);
        let running = 0;
        let peak = 0;
        const tasks = Array.from({ length: 10 }, () => task());
        const runs = tasks.map((t) => gate.run(async () => {
            running++;
            peak = Math.max(peak, running);
            try {
                return await t.promise;
            } finally {
                running--;
            }
        }));
        await tick();
        expect(running).toBe(3);
        for (const t of tasks) {
            t.finish("ok");
            await tick();
        }
        await Promise.all(runs);
        expect(peak).toBe(3);
        expect(running).toBe(0);
    });

    it("starts waiting tasks in the order they asked", async () => {
        const gate = createConcurrencyGate(1);
        const started: number[] = [];
        const tasks = [task(), task(), task(), task()];
        const runs = tasks.map((t, i) => gate.run(async () => {
            started.push(i);
            return await t.promise;
        }));
        await tick();
        expect(started).toEqual([0]);
        for (const t of tasks) {
            t.finish("ok");
            await tick();
        }
        await Promise.all(runs);
        expect(started).toEqual([0, 1, 2, 3]);
    });

    it("releases the slot when a task fails", async () => {
        const gate = createConcurrencyGate(1);
        const first = task();
        const second = task();
        const failing = gate.run(() => first.promise);
        const next = gate.run(() => second.promise);
        const outcome = expect(failing).rejects.toThrow("boom");
        first.fail(new Error("boom"));
        await outcome;
        second.finish("after");
        await expect(next).resolves.toBe("after");
        // The gate is empty again: a new task starts at once
        await expect(gate.run(async () => "free")).resolves.toBe("free");
    });

    it("rejects with an AbortError when the signal aborts while waiting, and the task never starts", async () => {
        const gate = createConcurrencyGate(1);
        const holder = task();
        const running = gate.run(() => holder.promise);
        const controller = new AbortController();
        let started = false;
        const waiting = gate.run(async () => {
            started = true;
            return "never";
        }, controller.signal);
        const behind = gate.run(async () => "behind");
        const outcome = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await outcome;
        holder.finish("done");
        await running;
        // The one behind the aborted task still gets its slot
        await expect(behind).resolves.toBe("behind");
        expect(started).toBe(false);
    });

    it("rejects at once when the signal is already aborted", async () => {
        const gate = createConcurrencyGate(2);
        const controller = new AbortController();
        controller.abort();
        await expect(gate.run(async () => "x", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    });
});
