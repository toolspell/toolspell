import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

const RESUBSCRIBE_DELAY = "1 second";

// Only a transport failure heals by itself. Undecodable protocol data (an `RpcClientDefect`, as
// after a server update the client does not understand), a denial, or a server defect would fail
// again the same way, so they end the stream and the page shows it.
const isTransportFailure = (error: unknown) =>
  Predicate.isTagged(error, "RpcClientError") &&
  !Predicate.isTagged((error as { readonly reason?: unknown }).reason, "RpcClientDefect");

/** Resubscribes after a dropped socket, once it is back; any other failure ends the stream. */
export const resubscribeOnTransportFailure = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  Stream.retry(
    stream,
    Schedule.spaced(RESUBSCRIBE_DELAY).pipe(
      Schedule.while(({ input }) => isTransportFailure(input)),
    ),
  );
