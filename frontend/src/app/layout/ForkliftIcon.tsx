import { createSvgIcon } from "@mui/material/utils";

/** Forklift (side view). @mui/icons-material 5.x has no forklift icon, so this draws one the same way. */
const ForkliftIcon = createSvgIcon(
  <path
    fillRule="evenodd"
    d="M15.5 3h2v16.5h-2zM17.5 17.5H23v2h-5.5zM3 11.5h11v4H3zM4 4h6.2l2.3 7H4zM5.5 5.5h3.6l1.2 4H5.5zM6 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
  />,
  "Forklift",
);

export default ForkliftIcon;
