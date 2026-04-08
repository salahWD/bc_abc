import { Button } from "@/components/ui/button";
import { Trash2, UserPlus, CheckCircle, Wallet, Truck, FileText, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PrepaidStatementDialog } from "./PrepaidStatementDialog";
import { ManifestDialog } from "./ManifestDialog";
import { DeliveryAttemptDialog } from "./DeliveryAttemptDialog";

interface BulkActionsBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

export function BulkActionsBar({ selectedIds, onClearSelection }: BulkActionsBarProps) {
  const queryClient = useQueryClient();
  const [driverOpen, setDriverOpen] = useState(false);
  const [thirdPartyOpen, setThirdPartyOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [prepaidDialogOpen, setPrepaidDialogOpen] = useState(false);
  const [manifestDialogOpen, setManifestDialogOpen] = useState(false);
  const [attemptDialogOpen, setAttemptDialogOpen] = useState(false);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: thirdParties = [] } = useQuery({
    queryKey: ["third-parties-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("third_parties").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch selected orders to check if they're ecom and get client info
  const { data: selectedOrders = [] } = useQuery({
    queryKey: ["selected-orders-bulk", selectedIds],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_type, client_id, prepaid_by_company, prepaid_by_runners, clients(name)")
        .in("id", selectedIds);
      if (error) throw error;
      return data;
    },
    enabled: selectedIds.length > 0,
  });

  // Check if all selected orders are ecom, same client, and not already prepaid
  // Show button for ALL ecom orders from same client that aren't prepaid yet
  const prepaidInfo = useMemo(() => {
    if (selectedOrders.length === 0) return { canPrepay: false, clientId: '', clientName: '' };

    const allEcom = selectedOrders.every(o => o.order_type === 'ecom');
    const allSameClient = selectedOrders.every(o => o.client_id === selectedOrders[0].client_id);
    const noneAlreadyPrepaid = selectedOrders.every(o => !o.prepaid_by_company);

    return {
      canPrepay: allEcom && allSameClient && noneAlreadyPrepaid,
      clientId: selectedOrders[0]?.client_id || '',
      clientName: (selectedOrders[0] as any)?.clients?.name || '',
    };
  }, [selectedOrders]);

  const assignDriverMutation = useMutation({
    mutationFn: async (driverId: string) => {
      // Update driver_id, set fulfillment to InHouse, clear third_party_id, and set status to "Assigned" if currently "New"
      const { error } = await supabase
        .from("orders")
        .update({ driver_id: driverId, fulfillment: "InHouse", third_party_id: null, status: "Assigned" })
        .in("id", selectedIds)
        .in("status", ["New", "Assigned"]); // Only update status for New or already Assigned orders

      if (error) throw error;

      // Also update orders that are in other statuses (just driver_id and fulfillment, not status)
      const { error: error2 } = await supabase
        .from("orders")
        .update({ driver_id: driverId, fulfillment: "InHouse", third_party_id: null })
        .in("id", selectedIds)
        .not("status", "in", '("New","Assigned")');

      if (error2) throw error2;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      toast.success(`Driver assigned to ${selectedIds.length} orders`);
      onClearSelection();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const assignThirdPartyMutation = useMutation({
    mutationFn: async (thirdPartyId: string) => {
      // Update third_party_id, set fulfillment to ThirdParty, clear driver_id, and set status to "Assigned"
      const { error } = await supabase
        .from("orders")
        .update({
          third_party_id: thirdPartyId,
          fulfillment: "ThirdParty",
          driver_id: null,
          status: "Assigned",
          third_party_settlement_status: "Pending"
        })
        .in("id", selectedIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      toast.success(`Third party assigned to ${selectedIds.length} orders`);
      onClearSelection();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      // Validate: Cannot mark as Delivered without a driver OR third party assigned
      if (status === 'Delivered') {
        const { data: orders } = await supabase
          .from("orders")
          .select("id, order_id, driver_id, third_party_id, fulfillment")
          .in("id", selectedIds);

        const ordersWithoutAssignment = orders?.filter(order =>
          !order.driver_id && !order.third_party_id
        ) || [];

        if (ordersWithoutAssignment.length > 0) {
          throw new Error(`Cannot mark orders as Delivered without assigning a driver or third party. ${ordersWithoutAssignment.length} order(s) have no assignment.`);
        }
      }

      // First update the status
      const updateData: any = { status };
      if (status === 'Delivered') {
        updateData.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase.from("orders").update(updateData).in("id", selectedIds);
      if (error) throw error;

      // If status is Delivered, process accounting for each order
      if (status === 'Delivered') {
        console.log(`Processing delivery accounting for ${selectedIds.length} orders...`);

        // Process each order through the edge function
        for (const orderId of selectedIds) {
          const { error: functionError } = await supabase.functions.invoke('process-order-delivery', {
            body: { orderId }
          });

          if (functionError) {
            console.error(`Error processing delivery for order ${orderId}:`, functionError);
            // Continue processing other orders even if one fails
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success(`Status updated for ${selectedIds.length} orders`);
      onClearSelection();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteOrdersMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("orders").delete().in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      toast.success(`${selectedIds.length} orders deleted`);
      onClearSelection();
      setDeleteDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      setDeleteDialogOpen(false);
    },
  });

  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-6 py-3 rounded-lg shadow-lg flex items-center gap-4 z-50">
        <span className="font-medium">{selectedIds.length} selected</span>

        {prepaidInfo.canPrepay && (
          <Button size="sm" variant="secondary" onClick={() => setPrepaidDialogOpen(true)}>
            <Wallet className="h-4 w-4 mr-2" />
            Prepay Orders
          </Button>
        )}

        <Popover open={driverOpen} onOpenChange={setDriverOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary">
              <UserPlus className="h-4 w-4 mr-2" />
              Assign Driver
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0 bg-popover">
            <Command>
              <CommandInput placeholder="Search driver..." />
              <CommandList>
                <CommandEmpty>No driver found.</CommandEmpty>
                <CommandGroup>
                  {drivers.map((driver) => (
                    <CommandItem
                      key={driver.id}
                      onSelect={() => {
                        assignDriverMutation.mutate(driver.id);
                        setDriverOpen(false);
                      }}
                    >
                      {driver.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={thirdPartyOpen} onOpenChange={setThirdPartyOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary">
              <Truck className="h-4 w-4 mr-2" />
              Assign 3rd Party
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0 bg-popover">
            <Command>
              <CommandInput placeholder="Search 3rd party..." />
              <CommandList>
                <CommandEmpty>No third party found.</CommandEmpty>
                <CommandGroup>
                  {thirdParties.map((tp) => (
                    <CommandItem
                      key={tp.id}
                      onSelect={() => {
                        assignThirdPartyMutation.mutate(tp.id);
                        setThirdPartyOpen(false);
                      }}
                    >
                      {tp.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary">
              <CheckCircle className="h-4 w-4 mr-2" />
              Update Status
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0 bg-popover">
            <Command>
              <CommandInput placeholder="Search status..." />
              <CommandList>
                <CommandEmpty>No status found.</CommandEmpty>
                <CommandGroup>
                  {["New", "Assigned", "PickedUp", "DriverCollected", "Returned", "Cancelled"].map((status) => (
                    <CommandItem
                      key={status}
                      onSelect={() => {
                        updateStatusMutation.mutate(status);
                        setStatusOpen(false);
                      }}
                    >
                      {status}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button size="sm" variant="secondary" onClick={() => setManifestDialogOpen(true)}>
          <FileText className="h-4 w-4 mr-2" />
          Create Manifest
        </Button>

        <Button size="sm" variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>

        <Button size="sm" variant="ghost" onClick={onClearSelection}>
          Clear
        </Button>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.length} orders?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete the selected orders.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteOrdersMutation.mutate()} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {prepaidInfo.canPrepay && (
        <PrepaidStatementDialog
          open={prepaidDialogOpen}
          onOpenChange={(open) => {
            setPrepaidDialogOpen(open);
            if (!open) onClearSelection();
          }}
          clientId={prepaidInfo.clientId}
          clientName={prepaidInfo.clientName}
          selectedOrderIds={selectedIds}
        />
      )}

      <ManifestDialog
        open={manifestDialogOpen}
        onOpenChange={setManifestDialogOpen}
        selectedOrderIds={selectedIds}
        onSuccess={onClearSelection}
      />
    </>
  );
}
