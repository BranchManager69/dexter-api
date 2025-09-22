

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "_prisma_migrations";


ALTER SCHEMA "_prisma_migrations" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_prisma_migrations" (
    "id" "text" NOT NULL,
    "checksum" "text" NOT NULL,
    "finished_at" timestamp with time zone,
    "migration_name" "text" NOT NULL,
    "logs" "text",
    "rolled_back_at" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_steps_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."_prisma_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_memory" (
    "token_address" character varying(44) NOT NULL,
    "schema_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "interactions_count" integer DEFAULT 0 NOT NULL,
    "digest_latest" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."agent_memory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_app_users" (
    "id" "text" NOT NULL,
    "name" character varying(255),
    "role" character varying(32) DEFAULT 'user'::character varying NOT NULL,
    "ext_user_id" integer,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ai_app_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_strategy_parameters" (
    "id" "text" NOT NULL,
    "version" character varying(20) NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "max_position_size_sol" numeric(20,9) DEFAULT 0.5 NOT NULL,
    "max_portfolio_exposure" numeric(5,4) DEFAULT 0.3 NOT NULL,
    "max_single_loss_sol" numeric(20,9) DEFAULT 0.1 NOT NULL,
    "stop_loss_percentage" numeric(5,4) DEFAULT 0.15 NOT NULL,
    "take_profit_percentage" numeric(5,4) DEFAULT 0.3 NOT NULL,
    "min_confidence_score" numeric(5,4) DEFAULT 0.65 NOT NULL,
    "min_liquidity_usd" numeric(20,2) DEFAULT 50000 NOT NULL,
    "min_volume_24h_usd" numeric(20,2) DEFAULT 10000 NOT NULL,
    "max_price_impact" numeric(5,4) DEFAULT 0.02 NOT NULL,
    "scan_interval_seconds" integer DEFAULT 300 NOT NULL,
    "decision_cooldown_minutes" integer DEFAULT 30 NOT NULL,
    "max_hold_duration_hours" integer DEFAULT 72 NOT NULL,
    "technical_weight" numeric(5,4) DEFAULT 0.4 NOT NULL,
    "social_weight" numeric(5,4) DEFAULT 0.3 NOT NULL,
    "fundamental_weight" numeric(5,4) DEFAULT 0.2 NOT NULL,
    "risk_weight" numeric(5,4) DEFAULT 0.1 NOT NULL,
    "max_daily_trades" integer DEFAULT 10 NOT NULL,
    "max_daily_loss_sol" numeric(20,9) DEFAULT 1.0 NOT NULL,
    "max_consecutive_losses" integer DEFAULT 3 NOT NULL,
    "pause_on_circuit_break" boolean DEFAULT true NOT NULL,
    "min_win_rate" numeric(5,4) DEFAULT 0.4 NOT NULL,
    "target_sharpe_ratio" numeric(10,4) DEFAULT 1.5 NOT NULL,
    "description" "text",
    "created_by" character varying(100) DEFAULT 'system'::character varying NOT NULL,
    "performance_stats" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "activated_at" timestamp(6) with time zone,
    "deactivated_at" timestamp(6) with time zone
);


ALTER TABLE "public"."ai_strategy_parameters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_token_analyses" (
    "id" integer NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "model" "text",
    "api" "text",
    "tool_calls_made" integer,
    "timings" "jsonb",
    "web_search_used" boolean,
    "web_citations" "jsonb",
    "token_type" "text",
    "branch_score" integer,
    "risk_score" integer,
    "summary" "text",
    "project_summary" "text",
    "file_path" "text",
    "analysis_json" "jsonb" NOT NULL
);


ALTER TABLE "public"."ai_token_analyses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ai_token_analyses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ai_token_analyses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ai_token_analyses_id_seq" OWNED BY "public"."ai_token_analyses"."id";



CREATE TABLE IF NOT EXISTS "public"."ai_trade_audit" (
    "id" bigint NOT NULL,
    "user_id" "text",
    "wallet_id" "text",
    "token_mint" character varying(64),
    "action" character varying(32) NOT NULL,
    "amount_ui" numeric(24,9),
    "tx_hash" character varying(128),
    "frames_json" "jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ai_trade_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ai_trade_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ai_trade_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ai_trade_audit_id_seq" OWNED BY "public"."ai_trade_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."ai_trade_decisions" (
    "id" "text" NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "decision_type" character varying(20) NOT NULL,
    "action" character varying(20) NOT NULL,
    "confidence_score" numeric(5,4) NOT NULL,
    "confidence_components" "jsonb" DEFAULT '{}'::"jsonb",
    "amount_sol" numeric(20,9),
    "price_target" numeric(20,9),
    "slippage_tolerance" numeric(5,4) DEFAULT 0.02 NOT NULL,
    "analysis_data" "jsonb" DEFAULT '{}'::"jsonb",
    "indicators" "jsonb" DEFAULT '{}'::"jsonb",
    "market_conditions" "jsonb" DEFAULT '{}'::"jsonb",
    "executed" boolean DEFAULT false NOT NULL,
    "execution_id" "text",
    "cancelled" boolean DEFAULT false NOT NULL,
    "cancel_reason" "text",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "executed_at" timestamp(6) with time zone,
    "expires_at" timestamp(6) with time zone
);


ALTER TABLE "public"."ai_trade_decisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_trade_executions" (
    "id" "text" NOT NULL,
    "decision_id" "text" NOT NULL,
    "wallet_id" "text" NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "signature" character varying(88) NOT NULL,
    "transaction_type" character varying(20) NOT NULL,
    "amount_in" numeric(20,9) NOT NULL,
    "amount_out" numeric(20,9) NOT NULL,
    "token_in" character varying(44) NOT NULL,
    "token_out" character varying(44) NOT NULL,
    "execution_price" numeric(20,9) NOT NULL,
    "slippage" numeric(5,4),
    "gas_fee" numeric(20,9),
    "platform_fee" numeric(20,9),
    "position_size_before" numeric(20,9),
    "position_size_after" numeric(20,9),
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "error_message" "text",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "confirmed_at" timestamp(6) with time zone
);


ALTER TABLE "public"."ai_trade_executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_trade_performance" (
    "id" "text" NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "entry_execution_id" "text" NOT NULL,
    "exit_execution_id" "text",
    "entry_price" numeric(20,9) NOT NULL,
    "entry_amount_sol" numeric(20,9) NOT NULL,
    "entry_timestamp" timestamp(6) with time zone NOT NULL,
    "exit_price" numeric(20,9),
    "exit_amount_sol" numeric(20,9),
    "exit_timestamp" timestamp(6) with time zone,
    "exit_reason" character varying(50),
    "pnl_sol" numeric(20,9),
    "pnl_percentage" numeric(10,4),
    "holding_period_minutes" integer,
    "max_drawdown" numeric(10,4),
    "max_profit" numeric(10,4),
    "entry_confidence" numeric(5,4) NOT NULL,
    "entry_analysis" "jsonb" DEFAULT '{}'::"jsonb",
    "exit_analysis" "jsonb" DEFAULT '{}'::"jsonb",
    "strategy_version" character varying(20),
    "market_regime" character varying(20),
    "lessons_learned" "jsonb" DEFAULT '{}'::"jsonb",
    "is_winner" boolean,
    "status" character varying(20) DEFAULT 'open'::character varying NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone NOT NULL
);


ALTER TABLE "public"."ai_trade_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_user_settings" (
    "user_id" "text" NOT NULL,
    "default_wallet_id" "text",
    "last_used_wallet_id" "text",
    "updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ai_user_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_user_tokens" (
    "token" character varying(255) NOT NULL,
    "user_id" "text" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ai_user_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_wallet_aliases" (
    "id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "wallet_id" "text" NOT NULL,
    "alias" character varying(255) NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ai_wallet_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."config_solana_engine" (
    "id" "text" NOT NULL,
    "token_metadata_ttl" integer DEFAULT 86400 NOT NULL,
    "token_price_ttl" integer DEFAULT 3600 NOT NULL,
    "wallet_data_ttl" integer DEFAULT 300 NOT NULL,
    "connection_strategy" "text" DEFAULT 'adaptive'::"text" NOT NULL,
    "health_check_interval" integer DEFAULT 60000 NOT NULL,
    "failure_threshold" integer DEFAULT 2 NOT NULL,
    "recovery_threshold" integer DEFAULT 3 NOT NULL,
    "max_concurrent_requests" integer DEFAULT 5 NOT NULL,
    "request_spacing_ms" integer DEFAULT 100 NOT NULL,
    "base_backoff_ms" integer DEFAULT 250 NOT NULL,
    "endpoint_weights" "jsonb" DEFAULT '{}'::"jsonb",
    "admin_bypass_cache" boolean DEFAULT false NOT NULL,
    "last_updated" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_by" character varying(44)
);


ALTER TABLE "public"."config_solana_engine" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connector_oauth_codes" (
    "code" character varying(128) NOT NULL,
    "client_id" character varying(255) NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "state" "text",
    "code_challenge" character varying(512),
    "code_challenge_method" character varying(32),
    "scope" "text",
    "refresh_token" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "supabase_user_id" character varying(255),
    "expires_in" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."connector_oauth_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connector_oauth_requests" (
    "id" character varying(64) NOT NULL,
    "client_id" character varying(255) NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "state" "text",
    "code_challenge" character varying(512),
    "code_challenge_method" character varying(32),
    "scope" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."connector_oauth_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."managed_wallets" (
    "id" "text" NOT NULL,
    "public_key" character varying(44) NOT NULL,
    "encrypted_private_key" "text" NOT NULL,
    "label" character varying(255),
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone NOT NULL,
    "memo" "text"
);


ALTER TABLE "public"."managed_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mcp_oauth_clients" (
    "client_id" "text" NOT NULL,
    "redirect_uris" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "grant_types" "text"[] DEFAULT ARRAY['authorization_code'::"text"] NOT NULL,
    "response_types" "text"[] DEFAULT ARRAY['code'::"text"] NOT NULL,
    "token_endpoint_auth_method" "text" DEFAULT 'none'::"text" NOT NULL,
    "application_type" "text" DEFAULT 'web'::"text",
    "pkce_required" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mcp_oauth_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_user_wallets" (
    "id" "text" NOT NULL,
    "provider" character varying(255) NOT NULL,
    "subject" character varying(255) NOT NULL,
    "email" character varying(255),
    "wallet_id" "text" NOT NULL,
    "default_wallet" boolean DEFAULT false NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone NOT NULL,
    "supabase_user_id" character varying(255)
);


ALTER TABLE "public"."oauth_user_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_messages" (
    "id" integer NOT NULL,
    "message_id" character varying(20) NOT NULL,
    "chat_id" character varying(20) NOT NULL,
    "telegram_user_id" character varying(20) NOT NULL,
    "username" character varying(32),
    "first_name" character varying(64),
    "text" "text",
    "message_type" character varying(20) DEFAULT 'text'::character varying NOT NULL,
    "caption" "text",
    "forward_from_user_id" character varying(20),
    "forward_from_chat_id" character varying(20),
    "forward_from_chat_type" character varying(20),
    "forward_signature" character varying(100),
    "forward_date" timestamp(6) with time zone,
    "reply_to_message_id" character varying(20),
    "reply_to_text" "text",
    "reply_to_user_id" character varying(20),
    "external_reply_chat_id" character varying(20),
    "external_reply_origin_type" character varying(20),
    "external_reply_author_signature" character varying(100),
    "quote_text" "text",
    "quote_position" integer,
    "is_automatic_forward" boolean DEFAULT false NOT NULL,
    "has_protected_content" boolean DEFAULT false NOT NULL,
    "has_media" boolean DEFAULT false NOT NULL,
    "media_type" character varying(20),
    "is_edited" boolean DEFAULT false NOT NULL,
    "event_type" character varying(20),
    "raw_data" "jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."telegram_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."telegram_messages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."telegram_messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."telegram_messages_id_seq" OWNED BY "public"."telegram_messages"."id";



CREATE TABLE IF NOT EXISTS "public"."telegram_messages_tokenai" (
    "id" integer NOT NULL,
    "mint" character varying(44) NOT NULL,
    "chat_ref" character varying(255) NOT NULL,
    "message_id" character varying(40) NOT NULL,
    "date" timestamp(6) with time zone,
    "text" "text",
    "views" integer,
    "forwards" integer,
    "reply_to_msg_id" character varying(40),
    "out" boolean DEFAULT false NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."telegram_messages_tokenai" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."telegram_messages_tokenai_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."telegram_messages_tokenai_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."telegram_messages_tokenai_id_seq" OWNED BY "public"."telegram_messages_tokenai"."id";



CREATE TABLE IF NOT EXISTS "public"."telegram_users" (
    "id" integer NOT NULL,
    "telegram_user_id" character varying(20) NOT NULL,
    "username" character varying(32),
    "first_name" character varying(64),
    "last_name" character varying(64),
    "is_bot" boolean DEFAULT false NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "is_linked" boolean DEFAULT false NOT NULL,
    "warning_count" integer DEFAULT 0 NOT NULL,
    "timeout_count" integer DEFAULT 0 NOT NULL,
    "ban_count" integer DEFAULT 0 NOT NULL,
    "first_seen" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "last_seen" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "last_message_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone NOT NULL
);


ALTER TABLE "public"."telegram_users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."telegram_users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."telegram_users_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."telegram_users_id_seq" OWNED BY "public"."telegram_users"."id";



CREATE TABLE IF NOT EXISTS "public"."token_socials" (
    "id" integer NOT NULL,
    "token_id" integer NOT NULL,
    "type" "text" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."token_socials" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."token_socials_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."token_socials_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."token_socials_id_seq" OWNED BY "public"."token_socials"."id";



CREATE TABLE IF NOT EXISTS "public"."token_websites" (
    "id" integer NOT NULL,
    "token_id" integer NOT NULL,
    "label" "text",
    "url" "text" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."token_websites" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."token_websites_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."token_websites_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."token_websites_id_seq" OWNED BY "public"."token_websites"."id";



CREATE TABLE IF NOT EXISTS "public"."tokens" (
    "id" integer NOT NULL,
    "address" "text" NOT NULL,
    "symbol" "text",
    "name" "text",
    "decimals" integer DEFAULT 9,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "image_url" "text",
    "description" "text",
    "color" "text" DEFAULT '#888888'::"text",
    "updated_at" timestamp(6) with time zone,
    "coingeckoId" "text",
    "tags" "jsonb",
    "last_price_change" timestamp(3) without time zone,
    "last_refresh_attempt" timestamp(3) without time zone,
    "last_refresh_success" timestamp(3) without time zone,
    "priority_score" integer DEFAULT 0 NOT NULL,
    "refresh_interval_seconds" integer DEFAULT 30 NOT NULL,
    "refresh_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "raw_supply" bigint,
    "total_supply" numeric(38,18),
    "discovery_count" integer DEFAULT 0,
    "metadata_status" "text" DEFAULT 'pending'::"text",
    "last_priority_calculation" timestamp(3) without time zone,
    "header_image_url" "text",
    "open_graph_image_url" "text",
    "first_seen_on_jupiter_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_is_active_evaluation_at" timestamp(3) without time zone,
    "last_jupiter_sync_at" timestamp(3) without time zone,
    "manually_activated" boolean DEFAULT false NOT NULL,
    "metadata_last_updated_at" timestamp(3) without time zone,
    "degenduel_score" numeric(20,8) DEFAULT 0,
    "score_calculated_at" timestamp(6) with time zone,
    "trend_category" character varying(50) DEFAULT 'Active'::character varying,
    "momentum_indicator" character varying(50) DEFAULT 'stable'::character varying,
    "source" character varying(50),
    "launchpad" character varying(50),
    "pool_derived_price" numeric(20,10),
    "pool_derived_volume_24h" numeric(20,2),
    "pool_derived_liquidity" numeric(20,2),
    "pool_derived_market_cap" numeric(20,2),
    "price_calculation_method" character varying(50),
    "pool_price_calculated_at" timestamp(6) with time zone
);


ALTER TABLE "public"."tokens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tokens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tokens_id_seq" OWNED BY "public"."tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."tweet_prediction_scores" (
    "id" integer NOT NULL,
    "tweet_id" character varying(32) NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "author_handle" character varying(50) NOT NULL,
    "tweet_timestamp" timestamp(3) without time zone NOT NULL,
    "prediction_type" character varying(20) NOT NULL,
    "prediction_text" "text",
    "target_price" double precision,
    "minutes_checked" integer NOT NULL,
    "price_before" double precision NOT NULL,
    "price_after" double precision NOT NULL,
    "price_change_pct" double precision NOT NULL,
    "volume_before" double precision,
    "volume_after" double precision,
    "accuracy_score" double precision NOT NULL,
    "verdict" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."tweet_prediction_scores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tweet_prediction_scores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tweet_prediction_scores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tweet_prediction_scores_id_seq" OWNED BY "public"."tweet_prediction_scores"."id";



CREATE TABLE IF NOT EXISTS "public"."twitter_community_members" (
    "token_address" character varying(44) NOT NULL,
    "community_url" "text" NOT NULL,
    "user_handle" character varying(50) NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "role" character varying(20) DEFAULT 'member'::character varying NOT NULL,
    "first_seen_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "last_seen_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."twitter_community_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."twitter_community_snapshots" (
    "id" integer NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "community_url" "text" NOT NULL,
    "community_name" "text",
    "snapshot_time" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "member_count" integer,
    "description" "text",
    "is_private" boolean DEFAULT false NOT NULL,
    "rules" "jsonb"
);


ALTER TABLE "public"."twitter_community_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."twitter_community_snapshots_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."twitter_community_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."twitter_community_snapshots_id_seq" OWNED BY "public"."twitter_community_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."twitter_snapshots" (
    "id" integer NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "snapshot_time" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "follower_count" integer,
    "following_count" integer,
    "tweet_count" integer,
    "is_verified" boolean,
    "profile_image_url" "text",
    "header_image_url" "text",
    "bio" "text",
    "location" "text",
    "website" "text",
    "join_date" "text",
    "display_name" character varying(200),
    "handle" character varying(100)
);


ALTER TABLE "public"."twitter_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."twitter_snapshots_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."twitter_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."twitter_snapshots_id_seq" OWNED BY "public"."twitter_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."twitter_tweets" (
    "tweet_id" character varying(32) NOT NULL,
    "token_address" character varying(44) NOT NULL,
    "author_handle" character varying(50) NOT NULL,
    "author_name" "text",
    "author_verified" boolean DEFAULT false NOT NULL,
    "tweet_text" "text",
    "tweet_timestamp" timestamp(3) without time zone NOT NULL,
    "tweet_url" "text",
    "first_seen_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "last_seen_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deleted_at" timestamp(6) with time zone,
    "likes_count" integer DEFAULT 0,
    "retweets_count" integer DEFAULT 0,
    "replies_count" integer DEFAULT 0,
    "views_count" bigint,
    "is_reply" boolean DEFAULT false NOT NULL,
    "reply_to_handle" character varying(50),
    "replied_tweet_id" character varying(32),
    "replied_tweet_data" "jsonb",
    "is_retweet" boolean DEFAULT false NOT NULL,
    "retweet_of_handle" character varying(50),
    "is_quote_tweet" boolean DEFAULT false NOT NULL,
    "quoted_tweet_id" character varying(32),
    "quoted_tweet_data" "jsonb",
    "is_thread" boolean DEFAULT false NOT NULL,
    "has_media" boolean DEFAULT false NOT NULL,
    "media_urls" "jsonb",
    "hashtags" "jsonb",
    "mentions" "jsonb",
    "external_links" "jsonb"
);


ALTER TABLE "public"."twitter_tweets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" NOT NULL,
    "supabase_user_id" character varying(255) NOT NULL,
    "tier" character varying(32) DEFAULT 'free'::character varying NOT NULL,
    "status" character varying(32) DEFAULT 'inactive'::character varying NOT NULL,
    "current_period_end" timestamp with time zone,
    "last_payment_at" timestamp with time zone,
    "last_payment_reference" "text",
    "payment_payload" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_token_analyses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_token_analyses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_trade_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_trade_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."telegram_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."telegram_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."telegram_messages_tokenai" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."telegram_messages_tokenai_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."telegram_users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."telegram_users_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."token_socials" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."token_socials_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."token_websites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."token_websites_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tweet_prediction_scores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tweet_prediction_scores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."twitter_community_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."twitter_community_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."twitter_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."twitter_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."_prisma_migrations"
    ADD CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_memory"
    ADD CONSTRAINT "agent_memory_pkey" PRIMARY KEY ("token_address");



ALTER TABLE ONLY "public"."ai_app_users"
    ADD CONSTRAINT "ai_app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_strategy_parameters"
    ADD CONSTRAINT "ai_strategy_parameters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_token_analyses"
    ADD CONSTRAINT "ai_token_analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_trade_audit"
    ADD CONSTRAINT "ai_trade_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_trade_decisions"
    ADD CONSTRAINT "ai_trade_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_trade_executions"
    ADD CONSTRAINT "ai_trade_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_trade_performance"
    ADD CONSTRAINT "ai_trade_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_user_settings"
    ADD CONSTRAINT "ai_user_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."ai_user_tokens"
    ADD CONSTRAINT "ai_user_tokens_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."ai_wallet_aliases"
    ADD CONSTRAINT "ai_wallet_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."config_solana_engine"
    ADD CONSTRAINT "config_solana_engine_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connector_oauth_codes"
    ADD CONSTRAINT "connector_oauth_codes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."connector_oauth_requests"
    ADD CONSTRAINT "connector_oauth_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."managed_wallets"
    ADD CONSTRAINT "managed_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_oauth_clients"
    ADD CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."oauth_user_wallets"
    ADD CONSTRAINT "oauth_user_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_messages"
    ADD CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_messages_tokenai"
    ADD CONSTRAINT "telegram_messages_tokenai_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_users"
    ADD CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_socials"
    ADD CONSTRAINT "token_socials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_websites"
    ADD CONSTRAINT "token_websites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tokens"
    ADD CONSTRAINT "tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tweet_prediction_scores"
    ADD CONSTRAINT "tweet_prediction_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."twitter_community_members"
    ADD CONSTRAINT "twitter_community_members_pkey" PRIMARY KEY ("community_url", "user_handle");



ALTER TABLE ONLY "public"."twitter_community_snapshots"
    ADD CONSTRAINT "twitter_community_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."twitter_snapshots"
    ADD CONSTRAINT "twitter_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."twitter_tweets"
    ADD CONSTRAINT "twitter_tweets_pkey" PRIMARY KEY ("tweet_id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_supabase_user_id_key" UNIQUE ("supabase_user_id");



CREATE INDEX "ai_strategy_parameters_is_active_version_idx" ON "public"."ai_strategy_parameters" USING "btree" ("is_active", "version");



CREATE UNIQUE INDEX "ai_strategy_parameters_version_key" ON "public"."ai_strategy_parameters" USING "btree" ("version");



CREATE INDEX "ai_token_analyses_token_address_created_at_idx" ON "public"."ai_token_analyses" USING "btree" ("token_address", "created_at");



CREATE INDEX "ai_trade_audit_user_id_created_at_idx" ON "public"."ai_trade_audit" USING "btree" ("user_id", "created_at");



CREATE INDEX "ai_trade_audit_wallet_id_created_at_idx" ON "public"."ai_trade_audit" USING "btree" ("wallet_id", "created_at");



CREATE INDEX "ai_trade_decisions_executed_created_at_idx" ON "public"."ai_trade_decisions" USING "btree" ("executed", "created_at");



CREATE INDEX "ai_trade_decisions_token_address_created_at_idx" ON "public"."ai_trade_decisions" USING "btree" ("token_address", "created_at");



CREATE UNIQUE INDEX "ai_trade_executions_decision_id_key" ON "public"."ai_trade_executions" USING "btree" ("decision_id");



CREATE INDEX "ai_trade_executions_status_created_at_idx" ON "public"."ai_trade_executions" USING "btree" ("status", "created_at");



CREATE INDEX "ai_trade_executions_wallet_id_created_at_idx" ON "public"."ai_trade_executions" USING "btree" ("wallet_id", "created_at");



CREATE INDEX "ai_trade_performance_status_created_at_idx" ON "public"."ai_trade_performance" USING "btree" ("status", "created_at");



CREATE INDEX "ai_trade_performance_token_address_created_at_idx" ON "public"."ai_trade_performance" USING "btree" ("token_address", "created_at");



CREATE INDEX "ai_user_settings_user_id_idx" ON "public"."ai_user_settings" USING "btree" ("user_id");



CREATE INDEX "ai_wallet_aliases_user_id_alias_idx" ON "public"."ai_wallet_aliases" USING "btree" ("user_id", "alias");



CREATE UNIQUE INDEX "ai_wallet_aliases_user_id_alias_key" ON "public"."ai_wallet_aliases" USING "btree" ("user_id", "alias");



CREATE INDEX "ai_wallet_aliases_wallet_id_idx" ON "public"."ai_wallet_aliases" USING "btree" ("wallet_id");



CREATE INDEX "connector_oauth_codes_created_at_idx" ON "public"."connector_oauth_codes" USING "btree" ("created_at");



CREATE INDEX "connector_oauth_requests_created_at_idx" ON "public"."connector_oauth_requests" USING "btree" ("created_at");



CREATE INDEX "idx_mcp_oauth_clients_created_at" ON "public"."mcp_oauth_clients" USING "btree" ("created_at");



CREATE INDEX "idx_tokens_active_score" ON "public"."tokens" USING "btree" ("is_active", "degenduel_score" DESC);



CREATE INDEX "idx_tokens_common_query" ON "public"."tokens" USING "btree" ("is_active", "metadata_status", "degenduel_score" DESC);



CREATE INDEX "idx_tokens_degenduel_score" ON "public"."tokens" USING "btree" ("degenduel_score" DESC);



CREATE INDEX "idx_tokens_symbol" ON "public"."tokens" USING "btree" ("symbol");



CREATE INDEX "idx_tokens_trend_category" ON "public"."tokens" USING "btree" ("trend_category");



CREATE UNIQUE INDEX "managed_wallets_public_key_key" ON "public"."managed_wallets" USING "btree" ("public_key");



CREATE INDEX "oauth_user_wallets_provider_subject_idx" ON "public"."oauth_user_wallets" USING "btree" ("provider", "subject");



CREATE UNIQUE INDEX "oauth_user_wallets_provider_subject_wallet_id_key" ON "public"."oauth_user_wallets" USING "btree" ("provider", "subject", "wallet_id");



CREATE INDEX "oauth_user_wallets_supabase_user_id_idx" ON "public"."oauth_user_wallets" USING "btree" ("supabase_user_id");



CREATE INDEX "telegram_messages_chat_id_created_at_idx" ON "public"."telegram_messages" USING "btree" ("chat_id", "created_at" DESC);



CREATE UNIQUE INDEX "telegram_messages_chat_id_message_id_key" ON "public"."telegram_messages" USING "btree" ("chat_id", "message_id");



CREATE INDEX "telegram_messages_chat_id_telegram_user_id_created_at_idx" ON "public"."telegram_messages" USING "btree" ("chat_id", "telegram_user_id", "created_at" DESC);



CREATE INDEX "telegram_messages_created_at_idx" ON "public"."telegram_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "telegram_messages_event_type_idx" ON "public"."telegram_messages" USING "btree" ("event_type");



CREATE INDEX "telegram_messages_external_reply_chat_id_idx" ON "public"."telegram_messages" USING "btree" ("external_reply_chat_id");



CREATE INDEX "telegram_messages_message_type_idx" ON "public"."telegram_messages" USING "btree" ("message_type");



CREATE INDEX "telegram_messages_quote_text_idx" ON "public"."telegram_messages" USING "btree" ("quote_text");



CREATE INDEX "telegram_messages_telegram_user_id_idx" ON "public"."telegram_messages" USING "btree" ("telegram_user_id");



CREATE INDEX "telegram_messages_tokenai_mint_chat_ref_date_idx" ON "public"."telegram_messages_tokenai" USING "btree" ("mint", "chat_ref", "date" DESC);



CREATE UNIQUE INDEX "telegram_messages_tokenai_mint_chat_ref_message_id_key" ON "public"."telegram_messages_tokenai" USING "btree" ("mint", "chat_ref", "message_id");



CREATE INDEX "telegram_users_is_admin_idx" ON "public"."telegram_users" USING "btree" ("is_admin");



CREATE INDEX "telegram_users_is_linked_idx" ON "public"."telegram_users" USING "btree" ("is_linked");



CREATE INDEX "telegram_users_last_seen_idx" ON "public"."telegram_users" USING "btree" ("last_seen");



CREATE INDEX "telegram_users_telegram_user_id_idx" ON "public"."telegram_users" USING "btree" ("telegram_user_id");



CREATE UNIQUE INDEX "telegram_users_telegram_user_id_key" ON "public"."telegram_users" USING "btree" ("telegram_user_id");



CREATE INDEX "telegram_users_username_idx" ON "public"."telegram_users" USING "btree" ("username");



CREATE INDEX "token_socials_token_id_idx" ON "public"."token_socials" USING "btree" ("token_id");



CREATE INDEX "token_websites_token_id_idx" ON "public"."token_websites" USING "btree" ("token_id");



CREATE INDEX "tweet_prediction_scores_author_handle_accuracy_score_idx" ON "public"."tweet_prediction_scores" USING "btree" ("author_handle", "accuracy_score");



CREATE INDEX "tweet_prediction_scores_token_address_created_at_idx" ON "public"."tweet_prediction_scores" USING "btree" ("token_address", "created_at");



CREATE INDEX "tweet_prediction_scores_tweet_id_idx" ON "public"."tweet_prediction_scores" USING "btree" ("tweet_id");



CREATE INDEX "twitter_community_members_community_url_idx" ON "public"."twitter_community_members" USING "btree" ("community_url");



CREATE INDEX "twitter_community_members_role_idx" ON "public"."twitter_community_members" USING "btree" ("role");



CREATE INDEX "twitter_community_members_token_address_idx" ON "public"."twitter_community_members" USING "btree" ("token_address");



CREATE INDEX "twitter_community_snapshots_community_url_idx" ON "public"."twitter_community_snapshots" USING "btree" ("community_url");



CREATE INDEX "twitter_community_snapshots_token_address_snapshot_time_idx" ON "public"."twitter_community_snapshots" USING "btree" ("token_address", "snapshot_time");



CREATE INDEX "twitter_snapshots_snapshot_time_idx" ON "public"."twitter_snapshots" USING "btree" ("snapshot_time");



CREATE INDEX "twitter_snapshots_token_address_snapshot_time_idx" ON "public"."twitter_snapshots" USING "btree" ("token_address", "snapshot_time");



CREATE INDEX "twitter_tweets_author_handle_idx" ON "public"."twitter_tweets" USING "btree" ("author_handle");



CREATE INDEX "twitter_tweets_deleted_at_idx" ON "public"."twitter_tweets" USING "btree" ("deleted_at");



CREATE INDEX "twitter_tweets_first_seen_at_idx" ON "public"."twitter_tweets" USING "btree" ("first_seen_at");



CREATE INDEX "twitter_tweets_token_address_tweet_timestamp_idx" ON "public"."twitter_tweets" USING "btree" ("token_address", "tweet_timestamp");



CREATE UNIQUE INDEX "unique_token_address" ON "public"."tokens" USING "btree" ("address");



CREATE INDEX "user_subscriptions_supabase_user_id_idx" ON "public"."user_subscriptions" USING "btree" ("supabase_user_id");



ALTER TABLE ONLY "public"."ai_trade_audit"
    ADD CONSTRAINT "ai_trade_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."ai_app_users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_trade_executions"
    ADD CONSTRAINT "ai_trade_executions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."ai_trade_decisions"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_trade_executions"
    ADD CONSTRAINT "ai_trade_executions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_trade_performance"
    ADD CONSTRAINT "ai_trade_performance_entry_execution_id_fkey" FOREIGN KEY ("entry_execution_id") REFERENCES "public"."ai_trade_executions"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_trade_performance"
    ADD CONSTRAINT "ai_trade_performance_exit_execution_id_fkey" FOREIGN KEY ("exit_execution_id") REFERENCES "public"."ai_trade_executions"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_user_settings"
    ADD CONSTRAINT "ai_user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."ai_app_users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_user_tokens"
    ADD CONSTRAINT "ai_user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."ai_app_users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_wallet_aliases"
    ADD CONSTRAINT "ai_wallet_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."ai_app_users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."oauth_user_wallets"
    ADD CONSTRAINT "oauth_user_wallets_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telegram_messages"
    ADD CONSTRAINT "telegram_messages_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."telegram_users"("telegram_user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_socials"
    ADD CONSTRAINT "token_socials_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."token_websites"
    ADD CONSTRAINT "token_websites_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON UPDATE CASCADE ON DELETE RESTRICT;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































GRANT ALL ON TABLE "public"."_prisma_migrations" TO "anon";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."agent_memory" TO "anon";
GRANT ALL ON TABLE "public"."agent_memory" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_memory" TO "service_role";



GRANT ALL ON TABLE "public"."ai_app_users" TO "anon";
GRANT ALL ON TABLE "public"."ai_app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_app_users" TO "service_role";



GRANT ALL ON TABLE "public"."ai_strategy_parameters" TO "anon";
GRANT ALL ON TABLE "public"."ai_strategy_parameters" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_strategy_parameters" TO "service_role";



GRANT ALL ON TABLE "public"."ai_token_analyses" TO "anon";
GRANT ALL ON TABLE "public"."ai_token_analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_token_analyses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_token_analyses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_token_analyses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_token_analyses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_trade_audit" TO "anon";
GRANT ALL ON TABLE "public"."ai_trade_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_trade_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_trade_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_trade_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_trade_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_trade_decisions" TO "anon";
GRANT ALL ON TABLE "public"."ai_trade_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_trade_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."ai_trade_executions" TO "anon";
GRANT ALL ON TABLE "public"."ai_trade_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_trade_executions" TO "service_role";



GRANT ALL ON TABLE "public"."ai_trade_performance" TO "anon";
GRANT ALL ON TABLE "public"."ai_trade_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_trade_performance" TO "service_role";



GRANT ALL ON TABLE "public"."ai_user_settings" TO "anon";
GRANT ALL ON TABLE "public"."ai_user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_user_settings" TO "service_role";



GRANT ALL ON TABLE "public"."ai_user_tokens" TO "anon";
GRANT ALL ON TABLE "public"."ai_user_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_user_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."ai_wallet_aliases" TO "anon";
GRANT ALL ON TABLE "public"."ai_wallet_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_wallet_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."config_solana_engine" TO "anon";
GRANT ALL ON TABLE "public"."config_solana_engine" TO "authenticated";
GRANT ALL ON TABLE "public"."config_solana_engine" TO "service_role";



GRANT ALL ON TABLE "public"."connector_oauth_codes" TO "anon";
GRANT ALL ON TABLE "public"."connector_oauth_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."connector_oauth_codes" TO "service_role";



GRANT ALL ON TABLE "public"."connector_oauth_requests" TO "anon";
GRANT ALL ON TABLE "public"."connector_oauth_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."connector_oauth_requests" TO "service_role";



GRANT ALL ON TABLE "public"."managed_wallets" TO "anon";
GRANT ALL ON TABLE "public"."managed_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."managed_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_oauth_clients" TO "anon";
GRANT ALL ON TABLE "public"."mcp_oauth_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_oauth_clients" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_user_wallets" TO "anon";
GRANT ALL ON TABLE "public"."oauth_user_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_user_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_messages" TO "anon";
GRANT ALL ON TABLE "public"."telegram_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."telegram_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."telegram_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."telegram_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_messages_tokenai" TO "anon";
GRANT ALL ON TABLE "public"."telegram_messages_tokenai" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_messages_tokenai" TO "service_role";



GRANT ALL ON SEQUENCE "public"."telegram_messages_tokenai_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."telegram_messages_tokenai_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."telegram_messages_tokenai_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_users" TO "anon";
GRANT ALL ON TABLE "public"."telegram_users" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."telegram_users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."telegram_users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."telegram_users_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."token_socials" TO "anon";
GRANT ALL ON TABLE "public"."token_socials" TO "authenticated";
GRANT ALL ON TABLE "public"."token_socials" TO "service_role";



GRANT ALL ON SEQUENCE "public"."token_socials_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."token_socials_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."token_socials_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."token_websites" TO "anon";
GRANT ALL ON TABLE "public"."token_websites" TO "authenticated";
GRANT ALL ON TABLE "public"."token_websites" TO "service_role";



GRANT ALL ON SEQUENCE "public"."token_websites_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."token_websites_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."token_websites_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tokens" TO "anon";
GRANT ALL ON TABLE "public"."tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tweet_prediction_scores" TO "anon";
GRANT ALL ON TABLE "public"."tweet_prediction_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."tweet_prediction_scores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tweet_prediction_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tweet_prediction_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tweet_prediction_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."twitter_community_members" TO "anon";
GRANT ALL ON TABLE "public"."twitter_community_members" TO "authenticated";
GRANT ALL ON TABLE "public"."twitter_community_members" TO "service_role";



GRANT ALL ON TABLE "public"."twitter_community_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."twitter_community_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."twitter_community_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."twitter_community_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."twitter_community_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."twitter_community_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."twitter_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."twitter_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."twitter_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."twitter_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."twitter_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."twitter_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."twitter_tweets" TO "anon";
GRANT ALL ON TABLE "public"."twitter_tweets" TO "authenticated";
GRANT ALL ON TABLE "public"."twitter_tweets" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
