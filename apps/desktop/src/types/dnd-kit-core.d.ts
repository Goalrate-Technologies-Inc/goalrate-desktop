declare module '@dnd-kit/core' {
  export type UniqueIdentifier = string | number;

  export type DragStartEvent = {
    active: {
      id: UniqueIdentifier;
    };
  };

  export type DragEndEvent = {
    active: {
      id: UniqueIdentifier;
    };
    over?: {
      id: UniqueIdentifier;
    } | null;
  };
}
