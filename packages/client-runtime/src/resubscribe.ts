import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

const RESUBSCRIBE_DELAY = "1 second";

/**
 * A dropped socket ends a subscription with an `RpcClientError`; it resumes once the socket is
 * back. A denial or a server defect would fail again the same way, so it ends the stream.
 */
export const resubscribeOnTransportFailure = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  Stream.retry(
    stream,
    Schedule.spaced(RESUBSCRIBE_DELAY).pipe(
      Schedule.while(({ input }) => Predicate.isTagged(input, "RpcClientError")),
    ),
  );
