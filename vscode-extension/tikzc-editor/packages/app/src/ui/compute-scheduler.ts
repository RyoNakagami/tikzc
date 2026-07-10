export type SingleFlightScheduler<Input> = {
  schedule: (input: Input) => void;
  dispose: () => void;
};

export type SingleFlightSchedulerOptions<Input, Output> = {
  run: (input: Input) => Promise<Output>;
  onStart?: (input: Input) => void;
  onSuccess?: (input: Input, output: Output) => void;
  onError?: (input: Input, error: unknown) => void;
};

export function createSingleFlightScheduler<Input, Output>(
  options: SingleFlightSchedulerOptions<Input, Output>
): SingleFlightScheduler<Input> {
  let disposed = false;
  let inFlight = false;
  let pending: Input | null = null;

  const runNext = (input: Input): void => {
    inFlight = true;
    options.onStart?.(input);
    void options.run(input)
      .then((output) => {
        if (disposed) {
          return;
        }
        options.onSuccess?.(input, output);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        options.onError?.(input, error);
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        inFlight = false;
        if (pending == null) {
          return;
        }
        const next = pending;
        pending = null;
        runNext(next);
      });
  };

  return {
    schedule(input: Input): void {
      if (disposed) {
        return;
      }
      if (inFlight) {
        pending = input;
        return;
      }
      runNext(input);
    },
    dispose(): void {
      disposed = true;
      pending = null;
    }
  };
}
