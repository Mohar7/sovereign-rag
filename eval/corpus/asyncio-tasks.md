# Coroutines, Tasks, and Concurrency in asyncio

A coroutine is defined with `async def`. Calling a coroutine function does not
run it; it returns a coroutine object that does nothing until it is awaited or
scheduled on the event loop. This is why simply calling an `async def` function
and discarding the result produces a "coroutine was never awaited" warning.

## Tasks wrap coroutines

`asyncio.create_task(coro)` wraps a coroutine in a `Task` and schedules it to
run on the event loop concurrently with other tasks. The task starts making
progress soon after creation, even before you await it. Awaiting the task later
retrieves its result or re-raises its exception.

## Running things concurrently

`asyncio.gather(*coros)` schedules several awaitables concurrently and returns a
list of their results in the same order the awaitables were passed in, once all
of them complete. By default, if any awaitable raises, `gather` propagates the
first exception immediately. Passing `return_exceptions=True` instead collects
exceptions into the result list rather than raising.

## Task groups

`asyncio.TaskGroup`, added in Python 3.11, is a context manager for structured
concurrency. When the `async with` block exits, it waits for every task created
inside it to finish. If any task raises, the group cancels the remaining tasks
and propagates the errors as an `ExceptionGroup`.

## Cancellation

Cancelling a task with `task.cancel()` raises `asyncio.CancelledError` inside the
coroutine at its next suspension point. Well-behaved code may catch
`CancelledError` to perform cleanup, but it should re-raise it so that
cancellation actually takes effect rather than being silently swallowed.
