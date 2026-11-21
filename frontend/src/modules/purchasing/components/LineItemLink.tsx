/**
 * A purchasing line's item name, linked to the Item Catalog (opened on that item)
 * when the line has an item. Old lines that only carry a product show plain text.
 */
import { Link } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { itemCatalogUrl, lineItemName, type LineItemLike } from "@/modules/purchasing/utils/itemDisplay";

export default function LineItemLink({ line, label }: { line: LineItemLike; label?: string }) {
  const text = label ?? lineItemName(line);
  if (!line.material_id) return <>{text}</>;
  return (
    <Link component={RouterLink} to={itemCatalogUrl(line.material_id)} underline="hover" onClick={(e) => e.stopPropagation()}>
      {text}
    </Link>
  );
}
