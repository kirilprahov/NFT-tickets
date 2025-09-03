import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
    createMint,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('nft-tickets', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.NftTickets as Program;
    const programId = program.programId;
    const walletPubkey = provider.wallet.publicKey;

    const collectionMintKp = Keypair.generate();
    const collectionMint = collectionMintKp.publicKey;

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority')],
        programId
    );

    const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
        'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
    );
    const SYSVAR_INSTRUCTIONS = new PublicKey(
        'Sysvar1nstructions1111111111111111111111111'
    );

    const findMetadataPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID
        )[0];

    const findMasterEditionPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
                Buffer.from('edition'),
            ],
            TOKEN_METADATA_PROGRAM_ID
        )[0];

    const waitSignatureConfirmed = async (sig: string, timeoutMs = 5000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const st = await provider.connection.getSignatureStatuses([sig]);
            const v = st.value[0];
            if (v) {
                if (v.err) throw new Error(`tx failed: ${JSON.stringify(v.err)}`);
                if (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized') return;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('tx not confirmed in time');
    };

    it('init_mint — creates mint with expected params', async () => {
        const sig = await program.methods
            .initMint()
            .accounts({
                mint: collectionMint,
                mintAuthority: mintAuthorityPda,
                payer: walletPubkey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([collectionMintKp])
            .rpc();
        await waitSignatureConfirmed(sig);

        const mintInfo = await getMint(provider.connection, collectionMint);
        assert.equal(mintInfo.decimals, 0);
        assert.equal(mintInfo.mintAuthority?.toBase58(), mintAuthorityPda.toBase58());
        assert.equal(Number(mintInfo.supply), 0);
    });

    it('mint_nft — mints 1 token to payer ATA', async () => {
        const ata = await getAssociatedTokenAddress(
            collectionMint,
            walletPubkey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const sig = await program.methods
            .mintNft()
            .accounts({
                mint: collectionMint,
                mintAuthority: mintAuthorityPda,
                payer: walletPubkey,
                associatedTokenAccount: ata,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();
        await waitSignatureConfirmed(sig);

        const ataAcc = await getAccount(provider.connection, ata);
        assert.equal(Number(ataAcc.amount), 1);
    });

    it('collection_init — creates Metadata and MasterEdition (no collection)', async () => {
        const metadataPda = findMetadataPda(collectionMint);
        const masterEditionPda = findMasterEditionPda(collectionMint);

        const sig = await program.methods
            .collectionInit('Collection', 'CLT', 'https://example.com/collection.json', 550)
            .accounts({
                payer: walletPubkey,
                mint: collectionMint,
                collection: null,
                metadata: metadataPda,
                masterEdition: masterEditionPda,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                mintAuthority: mintAuthorityPda,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS,
            })
            .rpc();
        await waitSignatureConfirmed(sig);

        const mdAcc = await provider.connection.getAccountInfo(metadataPda);
        const meAcc = await provider.connection.getAccountInfo(masterEditionPda);
        assert.ok(mdAcc);
        assert.ok(meAcc);
        assert.equal(mdAcc!.owner.toBase58(), TOKEN_METADATA_PROGRAM_ID.toBase58());
        assert.equal(meAcc!.owner.toBase58(), TOKEN_METADATA_PROGRAM_ID.toBase58());
    });

    it('ticket_init + verify_collection — mints a new NFT, sets collection, then verifies membership', async () => {
        const payerKp = (provider.wallet as any).payer as anchor.web3.Keypair;
        const ticketMintKp = Keypair.generate();

        await createMint(
            provider.connection,
            payerKp,
            mintAuthorityPda,
            mintAuthorityPda,
            0,
            ticketMintKp
        );

        const ticketMint = ticketMintKp.publicKey;
        const ticketMetadataPda = findMetadataPda(ticketMint);
        const ticketMasterEditionPda = findMasterEditionPda(ticketMint);

        const sig1 = await program.methods
            .ticketInit('Ticket #1', 'TIX', 'https://example.com/ticket.json', 550)
            .accounts({
                payer: walletPubkey,
                mint: ticketMint,
                collection: collectionMint,
                metadata: ticketMetadataPda,
                masterEdition: ticketMasterEditionPda,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                mintAuthority: mintAuthorityPda,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS,
            })
            .rpc();
        await waitSignatureConfirmed(sig1);

        const tMdAcc = await provider.connection.getAccountInfo(ticketMetadataPda);
        const tMeAcc = await provider.connection.getAccountInfo(ticketMasterEditionPda);
        assert.ok(tMdAcc);
        assert.ok(tMeAcc);
        assert.equal(tMdAcc!.owner.toBase58(), TOKEN_METADATA_PROGRAM_ID.toBase58());
        assert.equal(tMeAcc!.owner.toBase58(), TOKEN_METADATA_PROGRAM_ID.toBase58());

        const sig2 = await program.methods
            .verifyCollection()
            .accounts({
                collectionMint: collectionMint,
                payer: walletPubkey,
                mintAuthority: mintAuthorityPda,
                collectionMetadata: findMetadataPda(collectionMint),
                collectionMasterEdition: findMasterEditionPda(collectionMint),
                metadata: ticketMetadataPda,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            })
            .rpc();
        await waitSignatureConfirmed(sig2);
    });
});
