import { RouteObject } from "react-router-dom";
import GroupsPage from "./pages/GroupsPage";

export const groupsRoutes: RouteObject[] = [
  {
    path: "/roles",
    element: <GroupsPage />,
  },
];
