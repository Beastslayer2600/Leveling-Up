import { stateRoute } from "../server/app";
import { route } from "../server/deps";

const handle = route(stateRoute);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
