# Blocking Code and Synchronization in asyncio

Because the asyncio event loop is single-threaded, any synchronous call that
blocks the thread also blocks the entire loop. A call to `time.sleep()`, a
CPU-bound computation, or a synchronous network library will prevent every other
task from running until it returns. The asyncio-friendly way to pause is
`await asyncio.sleep(seconds)`, which yields control back to the loop instead of
blocking the thread.

## Offloading blocking work

To call blocking or CPU-bound code without freezing the loop, run it in an
executor. `loop.run_in_executor(None, func, *args)` runs `func` in the default
thread pool executor and returns an awaitable for its result. The high-level
helper `asyncio.to_thread(func, *args)`, added in Python 3.9, does the same with
a simpler interface and is the preferred option for offloading blocking IO.

## Synchronization primitives

asyncio provides `Lock`, `Event`, `Semaphore`, and `Condition` that mirror the
ones in the `threading` module but are designed for coroutines and must be
awaited. An `asyncio.Lock` is not thread-safe; it only coordinates coroutines
running on the same event loop and should never be shared across threads.

## Timeouts

`asyncio.timeout(delay)` is an async context manager, added in Python 3.11, that
cancels the work inside its block if it does not finish within `delay` seconds,
raising `TimeoutError`. The older `asyncio.wait_for(awaitable, timeout)` wraps a
single awaitable with a timeout and cancels it if the deadline passes.
