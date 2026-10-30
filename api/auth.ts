import { authRoute } from "../server/app";
import { route } from "../server/deps";

const handle = route(authRoute);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
