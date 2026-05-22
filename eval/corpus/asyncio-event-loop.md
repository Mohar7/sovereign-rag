# The Python asyncio Event Loop

The event loop is the core of every asyncio application. It is a single-threaded
loop that runs asynchronous tasks and callbacks, performs network IO operations,
and runs subprocesses. At any given moment exactly one task is running on the
event loop; concurrency comes from interleaving tasks at `await` points rather
than from running them on multiple threads in parallel.

## Obtaining the running loop

Inside a coroutine you obtain the currently running loop with
`asyncio.get_running_loop()`. This function raises a `RuntimeError` if it is
called when no event loop is running. The older `asyncio.get_event_loop()`
function is discouraged inside coroutines because its behavior depends on the
current context and it may create a new loop implicitly.

## Running a program

`asyncio.run(coro)` is the recommended high-level entry point. It creates a new
event loop, runs the given coroutine until it completes, and then closes the
loop. `asyncio.run()` should be called only once per program and cannot be
called when another event loop is already running in the same thread.

## How tasks yield control

When a coroutine reaches an `await` expression on something that is not yet
ready, it yields control back to the event loop. The event loop is then free to
resume some other ready task. This cooperative scheduling means that a single
coroutine that performs a long blocking call without awaiting will starve every
other task on the loop, because the loop cannot preempt running code.

## Scheduling callbacks

`loop.call_soon(callback)` schedules a callback to be run on the next iteration
of the event loop. `loop.call_later(delay, callback)` schedules it after a
delay in seconds. Callbacks are always run in the order they were scheduled and
are never run concurrently with each other.
