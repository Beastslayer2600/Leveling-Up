import { coachRoute } from "../server/app";
import { route } from "../server/deps";

const handle = route(coachRoute);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
