"use client";

import React, { useState, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { fetcher } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { AlertTriangle, InfoIcon, Send, Hourglass, PlusCircle, Edit2, Trash2, ArrowUpDown, Eye, Loader2, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import EmptyState from '@/components/shared/EmptyState';

interface WalletNote {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  walletAddress: string;
  userId: string;
  user: {
    id: string;
    description: string | null;
  };
}

interface ReviewerLogTabProps {
  walletAddress: string;
}

export default function ReviewerLogTab({ walletAddress }: ReviewerLogTabProps) {
  const { toast } = useToast();
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInputArea, setShowInputArea] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [noteToDelete, setNoteToDelete] = useState<WalletNote | null>(null);
  const [noteToViewFull, setNoteToViewFull] = useState<WalletNote | null>(null);
  const [editingNote, setEditingNote] = useState<{ id: string; content: string } | null>(null);
  const [isUpdatingNote, setIsUpdatingNote] = useState(false);

  const notesApiUrl = walletAddress ? `/api/v1/wallets/${walletAddress}/notes` : null;

  const { data: notes, error: notesError, isLoading: isLoadingNotes } = useSWR<WalletNote[], Error & { status?: number; payload?: any }>(notesApiUrl, fetcher, {
    refreshInterval: 30000,
  });

  const sortedNotes = useMemo(() => {
    if (!notes) return [];
    return [...notes].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }, [notes, sortOrder]);

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !walletAddress) {
      toast({
        title: 'Error',
        description: 'Note content cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await fetcher(notesApiUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNoteContent }),
      });
      
      setNewNoteContent('');
      setShowInputArea(false);
      toast({
        title: 'Note Added',
        description: 'Your note has been successfully added.',
      });
      mutate(notesApiUrl); 
    } catch (err) {
      const error = err as Error & { status?: number; payload?: any };
      toast({
        title: 'Submission Failed',
        description: error.payload?.message || error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
      console.error("Failed to submit note:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!noteId || !walletAddress) return;

    const deleteUrl = `/api/v1/wallets/${walletAddress}/notes/${noteId}`;
    
    try {
      await fetcher(deleteUrl, { method: 'DELETE' });
      toast({
        title: 'Note Deleted',
        description: `Note has been deleted.`,
      });
      mutate(notesApiUrl);
      setNoteToDelete(null);
    } catch (err) {
      const error = err as Error & { status?: number; payload?: any };
      toast({
        title: 'Deletion Failed',
        description: error.payload?.message || error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
      console.error("Failed to delete note:", error);
    }
  };

  const handleEditNote = (note: WalletNote) => {
    setEditingNote({ id: note.id, content: note.content });
  };

  const handleCancelEdit = () => {
    setEditingNote(null);
  };

  const handleUpdateNoteContentChange = (content: string) => {
    if (editingNote) {
      setEditingNote({ ...editingNote, content });
    }
  };

  const handleSaveUpdatedNote = async () => {
    if (!editingNote || !walletAddress) return;
    if (!editingNote.content.trim()) {
      toast({
        title: "Error",
        description: "Note content cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    setIsUpdatingNote(true);
    const updateUrl = `/api/v1/wallets/${walletAddress}/notes/${editingNote.id}`;
    try {
      await fetcher(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingNote.content }),
      });
      toast({
        title: "Note Updated",
        description: "Your note has been successfully updated.",
      });
      mutate(notesApiUrl);
      setEditingNote(null);
    } catch (err) {
      const error = err as Error & { status?: number; payload?: any };
      toast({
        title: "Update Failed",
        description: error.payload?.message || error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      console.error("Failed to update note:", error);
    } finally {
      setIsUpdatingNote(false);
    }
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };
  
  // Loading State
  if (isLoadingNotes) {
    return (
      <Card className="mt-8 flex flex-col items-center justify-center min-h-[300px]">
        <EmptyState
          variant="default"
          icon={Loader2}
          title="Loading..."
          description="Please wait while we fetch your notes."
          className="border-none shadow-none"
        />
      </Card>
    );
  }

  // Error State
  if (notesError) {
    if (notesError.status === 404) {
      // Wallet not found or no notes endpoint for this wallet (interpreted as wallet not found for notes)
      return (
        <Card className="mt-8 flex flex-col items-center justify-center min-h-[300px]">
          <EmptyState
            variant="error"
            icon={AlertTriangle}
            title="Wallet Not Found for Notes"
            description="This wallet address may be invalid or notes cannot be accessed for it."
            className="border-none shadow-none"
          />
        </Card>
      );
    }
    // Generic error for other issues
    return (
      <Card className="mt-8 flex flex-col items-center justify-center min-h-[300px]">
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          title="Error Loading Notes"
          description={notesError.message || "An unexpected error occurred while fetching notes."}
          actionText="Retry"
          onActionClick={() => mutate(notesApiUrl)}
          className="border-none shadow-none"
        />
      </Card>
    );
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle> Notes</CardTitle>
        <CardDescription>Add and view notes for this wallet.</CardDescription>
        <div className="mt-4">
            <Button onClick={() => setShowInputArea(!showInputArea)} variant={showInputArea ? "outline" : "default"} size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                {showInputArea ? 'Cancel Adding Note' : 'Add New Note'}
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showInputArea && (
          <form onSubmit={handleNoteSubmit} className="space-y-4 my-6 p-4 border rounded-md bg-muted/30">
            <Textarea
              placeholder="Type your note here..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              rows={4}
              disabled={isSubmitting}
              className="bg-background"
            />
            <Button type="submit" disabled={isSubmitting || !newNoteContent.trim()} size="sm">
              {isSubmitting ? (
                <><Hourglass className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
              ) : (
                <><Send className="mr-2 h-4 w-4" /> Submit Note</>
              )}
            </Button>
          </form>
        )}

        <h3 className="text-lg font-semibold my-3 pt-3 border-t">Existing Notes</h3>
        
        {sortedNotes.length === 0 && !showInputArea && (
           <EmptyState
            variant="info"
            icon={FileText}
            title="No Notes Available"
            description="You haven't added any notes for this wallet yet."
            actionText="Add Note"
            onActionClick={() => setShowInputArea(true)}
            className="my-6"
          />
        )}

        {sortedNotes.length > 0 && (
          <ScrollArea className="h-[400px] pr-4">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/80 z-10">
                <TableRow>
                  <TableHead className="w-[200px] cursor-pointer hover:bg-muted" onClick={toggleSortOrder}>
                    <div className="flex items-center">
                        Date Added
                        <ArrowUpDown className="ml-2 h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[150px]">Author</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[150px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell>
                        <span className="text-xs">{format(new Date(note.createdAt), 'MMM d, yyyy, hh:mm a')}</span>
                    </TableCell>
                    <TableCell className="text-xs">{note.user?.description || note.user?.id || 'Unknown'}</TableCell>
                    <TableCell className="text-sm whitespace-pre-wrap">
                      {truncateText(note.content, 120)} 
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setNoteToViewFull(note)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>View Full Note</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditNote(note)}>
                                <Edit2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Edit Note</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <AlertDialog>
                        <TooltipProvider delayDuration={100}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertDialogTrigger asChild>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
                                        >
                                        <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Delete Note</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the note:
                                <br />
                                <strong className="block mt-2 p-2 bg-muted rounded text-sm">"{note.content}"</strong>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                                onClick={() => handleDeleteNote(note.id)}
                                className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white dark:text-white"
                            >
                                Yes, delete note
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Dialog for Viewing Full Note */}
        {noteToViewFull && (
          <Dialog open={!!noteToViewFull} onOpenChange={(open: boolean) => !open && setNoteToViewFull(null)}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Full Note Content</DialogTitle>
                <DialogDescription>
                  Author: {noteToViewFull.user?.description || noteToViewFull.user?.id || 'Unknown'} | Added: {format(new Date(noteToViewFull.createdAt), 'MMM d, yyyy, hh:mm a')}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] my-4 pr-3">
                  <p className="text-sm whitespace-pre-wrap break-words">{noteToViewFull.content}</p>
              </ScrollArea>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Dialog for Editing Note */}
        {editingNote && (
          <Dialog open={!!editingNote} onOpenChange={(open: boolean) => { if (!open) handleCancelEdit(); }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Note</DialogTitle>
                <DialogDescription>
                  Modify your note content below. Click save when you're done.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <Textarea
                  value={editingNote.content}
                  onChange={(e) => handleUpdateNoteContentChange(e.target.value)}
                  rows={10}
                  className="min-h-[150px]"
                  disabled={isUpdatingNote}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                   <Button type="button" variant="outline" onClick={handleCancelEdit} disabled={isUpdatingNote}>
                      Cancel
                  </Button>
                </DialogClose>
                <Button type="button" onClick={handleSaveUpdatedNote} disabled={isUpdatingNote || !editingNote.content.trim()}>
                  {isUpdatingNote ? <><Hourglass className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

      </CardContent>
    </Card>
  );
}

async function handleDeleteNote(noteId: string, walletAddress: string, toast: any, notesApiUrl: string | null, mutateSWR: any) {
  if (!noteId || !walletAddress) return;

  const deleteUrl = `/api/v1/wallets/${walletAddress}/notes/${noteId}`;
  
  try {
    await fetcher(deleteUrl, { method: 'DELETE' });
    toast({
      title: 'Note Deleted',
      description: `Note has been deleted.`,
    });
    if (notesApiUrl) mutateSWR(notesApiUrl); // Revalidate SWR cache for notes
  } catch (err) {
    const error = err as Error & { status?: number; payload?: any };
    toast({
      title: 'Deletion Failed',
      description: error.payload?.message || error.message || 'An unexpected error occurred.',
      variant: 'destructive',
    });
    console.error("Failed to delete note:", error);
  }
} 