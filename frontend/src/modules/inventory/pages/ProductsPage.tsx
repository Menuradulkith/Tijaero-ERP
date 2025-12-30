import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Chip,
  Tabs,
  Tab,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import { productsApi, categoriesApi, brandsApi } from "../api";
import { Product } from "../types";
import ProductDialog from "../components/ProductDialog";
import CategoryDialog from "../components/CategoryDialog";
import BrandDialog from "../components/BrandDialog";
import { usePermission } from "@/auth/permissions";
import { toast } from "react-hot-toast";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [tabValue, setTabValue] = useState(0);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [brandDialogOpen, setBrandDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const canCreate = usePermission("inventory", "create");
  const canUpdate = usePermission("inventory", "update");
  const canDelete = usePermission("inventory", "delete");

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["products", searchQuery],
    queryFn: () =>
      searchQuery ? productsApi.search(searchQuery) : productsApi.getAll(),
    enabled: tabValue === 0,
  });

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: tabValue === 1,
  });

  const { data: brands, isLoading: brandsLoading } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(),
    enabled: tabValue === 2,
  });

  const deleteMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete product");
    },
  });

  const handleCreateProduct = () => {
    setSelectedProduct(null);
    setProductDialogOpen(true);
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductDialogOpen(true);
  };

  const handleDeleteProduct = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4">Inventory</Typography>
        {canCreate && (
          <Box sx={{ display: "flex", gap: 1 }}>
            {tabValue === 0 && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleCreateProduct}
              >
                Add Product
              </Button>
            )}
            {tabValue === 1 && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCategoryDialogOpen(true)}
              >
                Add Category
              </Button>
            )}
            {tabValue === 2 && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setBrandDialogOpen(true)}
              >
                Add Brand
              </Button>
            )}
          </Box>
        )}
      </Box>

      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab label="Products" />
          <Tab label="Categories" />
          <Tab label="Brands" />
        </Tabs>
      </Paper>

      {tabValue === 0 && (
        <>
          <Paper sx={{ mb: 3, p: 2 }}>
            <TextField
              fullWidth
              placeholder="Search products by name, code, or model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Paper>

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Item Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Cost Price</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {productsLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : products?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      No products found
                    </TableCell>
                  </TableRow>
                ) : (
                  products?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>{product.item_code}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.model || "-"}</TableCell>
                      <TableCell>{product.item_type}</TableCell>
                      <TableCell>${product.cost_price.toFixed(2)}</TableCell>
                      <TableCell>
                        <Chip
                          label={product.active ? "Active" : "Inactive"}
                          size="small"
                          color={product.active ? "success" : "default"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {canUpdate && (
                          <IconButton
                            size="small"
                            onClick={() => handleEditProduct(product)}
                          >
                            <EditIcon />
                          </IconButton>
                        )}
                        {canDelete && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteProduct(product.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {tabValue === 1 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {categoriesLoading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : categories?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    No categories found
                  </TableCell>
                </TableRow>
              ) : (
                categories?.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.category_code}</TableCell>
                    <TableCell>{category.name}</TableCell>
                    <TableCell>{category.description || "-"}</TableCell>
                    <TableCell>
                      <Chip
                        label={category.active ? "Active" : "Inactive"}
                        size="small"
                        color={category.active ? "success" : "default"}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tabValue === 2 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {brandsLoading ? (
                <TableRow>
                  <TableCell colSpan={3} align="center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : brands?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center">
                    No brands found
                  </TableCell>
                </TableRow>
              ) : (
                brands?.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell>{brand.brand_code}</TableCell>
                    <TableCell>{brand.brand_name}</TableCell>
                    <TableCell>{brand.description || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ProductDialog
        open={productDialogOpen}
        product={selectedProduct}
        onClose={() => setProductDialogOpen(false)}
      />
      <CategoryDialog
        open={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
      />
      <BrandDialog
        open={brandDialogOpen}
        onClose={() => setBrandDialogOpen(false)}
      />
    </Box>
  );
}
