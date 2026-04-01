import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@goalrate-app/ui/primitives';
import { Button } from '@goalrate-app/ui/primitives';
import type { VaultListItem } from '@goalrate-app/shared';

export function VaultSelector(): React.ReactElement {
  const [vaults] = useState<VaultListItem[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vaults</CardTitle>
      </CardHeader>
      <CardContent>
        {vaults.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground mb-4">No vaults found</p>
            <Button>Create New Vault</Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {vaults.map((vault) => (
              <li key={vault.id} className="p-2 rounded hover:bg-muted">
                {vault.name}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
